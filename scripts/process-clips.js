#!/usr/bin/env node
/**
 * scripts/process-clips.js
 * Runs on GitHub Actions to source real NBA highlight clips.
 *
 * Usage: node scripts/process-clips.js <batchId> <rowIds>
 *   batchId: e.g., "2026-W14-A"
 *   rowIds: JSON array or comma-separated: "2026-W14-A-1,2026-W14-A-2"
 *
 * Pipeline per script:
 *   1. Read script from Vercel KV
 *   2. Claude plans clip slots (what to show at each timestamp)
 *   3. YouTube search for highlight compilations
 *   4. yt-dlp downloads 2.5s segments with scene detection
 *   5. FFmpeg transforms (crop, color grade, mirror, speed, vignette)
 *   6. Upload to Cloudflare R2
 *   7. Save clipBriefs + playerPhotoUrl back to KV
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ── KV helpers (direct REST API, no Vercel SDK needed) ──
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvGet(key) {
  const resp = await fetch(`${KV_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const data = await resp.json();
  if (data.result === null) return null;
  try { return JSON.parse(data.result); } catch { return data.result; }
}

async function kvSet(key, value, ttl = 86400 * 30) {
  await fetch(`${KV_URL}/set/${key}/${JSON.stringify(value)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    body: JSON.stringify(["EX", ttl]),
  });
}

// ── Claude API ──
async function askClaude(prompt, maxTokens = 2000) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await resp.json();
  const text = data.content?.[0]?.text || "";
  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  return null;
}

// ── YouTube search ──
async function searchYouTube(query, maxResults = 5) {
  const params = new URLSearchParams({
    part: "snippet",
    q: query,
    type: "video",
    maxResults: String(maxResults),
    videoDuration: "medium", // 4-20 minutes
    key: process.env.YOUTUBE_API_KEY,
  });
  const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  const data = await resp.json();
  return (data.items || []).map(item => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
  }));
}

// ── Blocklist for DMCA safety ──
const BLOCKED_CHANNELS = [
  "NBA", "ESPN", "TNT Sports", "Bleacher Report",
  "House of Highlights", "NBA on ESPN", "NBA on TNT",
];

function isBlockedChannel(channelTitle) {
  return BLOCKED_CHANNELS.some(b =>
    channelTitle.toLowerCase().includes(b.toLowerCase())
  );
}

// ── yt-dlp download ──
function downloadClip(videoId, startTime, duration, outputPath) {
  const startStr = formatTime(startTime);
  const endStr = formatTime(startTime + duration);
  // Use "best" format (combined audio+video) to avoid merge issues
  // Fallback chain: best 1080p → best available
  const cmd = `yt-dlp -f "best[height<=1080]/best" --download-sections "*${startStr}-${endStr}" --force-keyframes-at-cuts -o "${outputPath}" --no-playlist --quiet --no-warnings --no-check-certificates "https://youtube.com/watch?v=${videoId}"`;

  try {
    execSync(cmd, { timeout: 30000, stdio: "pipe" });
    return fs.existsSync(outputPath);
  } catch (e) {
    console.error(`  yt-dlp failed for ${videoId} at ${startStr}: ${e.message.slice(0, 100)}`);
    return false;
  }
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── FFmpeg scene detection ──
function detectScenes(videoPath) {
  try {
    const cmd = `ffmpeg -i "${videoPath}" -vf "select='gt(scene,0.3)',showinfo" -vsync vfn -f null - 2>&1`;
    const output = execSync(cmd, { timeout: 30000, encoding: "utf8" });
    const times = [];
    const regex = /pts_time:([\d.]+)/g;
    let match;
    while ((match = regex.exec(output)) !== null) {
      times.push(parseFloat(match[1]));
    }
    return times;
  } catch {
    return [];
  }
}

// ── FFmpeg transform ──
const COLOR_GRADES = {
  nostalgic:  "eq=contrast=1.1:brightness=-0.02:saturation=0.85",
  melancholy: "eq=contrast=1.15:brightness=-0.05:saturation=0.7",
  epic:       "eq=contrast=1.2:brightness=0.02:saturation=1.15",
  hype:       "eq=contrast=1.25:brightness=0.03:saturation=1.2",
  dramatic:   "eq=contrast=1.2:brightness=-0.02:saturation=0.95",
  dark:       "eq=contrast=1.3:brightness=-0.05:saturation=0.8",
  inspiring:  "eq=contrast=1.15:brightness=0.02:saturation=1.1",
};

function transformClip(inputPath, outputPath, mood, mirror = false) {
  const colorGrade = COLOR_GRADES[mood] || COLOR_GRADES.dramatic;
  const speedFactor = 0.93 + Math.random() * 0.14; // 0.93-1.07
  const cropPercent = 60 + Math.floor(Math.random() * 21); // 60-80%

  let filters = [
    // Crop to focus area (random offset for variety)
    `crop=iw*${cropPercent}/100:ih*${cropPercent}/100:(iw-iw*${cropPercent}/100)/2:(ih-ih*${cropPercent}/100)/2`,
    // Scale to vertical 1080x1920
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920",
    // Color grade
    colorGrade,
    // Speed shift
    `setpts=${(1 / speedFactor).toFixed(3)}*PTS`,
    // Vignette
    "vignette=PI/4",
  ];

  if (mirror) {
    filters.push("hflip");
  }

  const filterStr = filters.join(",");
  const cmd = `ffmpeg -i "${inputPath}" -vf "${filterStr}" -c:v libx264 -preset medium -crf 18 -r 30 -an -pix_fmt yuv420p -movflags +faststart -y "${outputPath}"`;

  try {
    execSync(cmd, { timeout: 60000, stdio: "pipe" });
    return fs.existsSync(outputPath);
  } catch (e) {
    console.error(`  FFmpeg transform failed: ${e.message.slice(0, 100)}`);
    return false;
  }
}

// ── R2 upload ──
async function uploadToR2(filePath, key) {
  const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  const body = fs.readFileSync(filePath);
  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: "video/mp4",
  }));

  // Public URL via R2 public development URL
  return `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev/${key}`;
}

// ── Player image sourcing ──
async function getPlayerImage(playerName, sport) {
  // Wikipedia search
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(playerName)}&prop=pageimages&format=json&pithumbsize=400`;
    const resp = await fetch(searchUrl);
    const data = await resp.json();
    const pages = data.query?.pages || {};
    for (const page of Object.values(pages)) {
      if (page.thumbnail?.source) return page.thumbnail.source;
    }
  } catch {}

  // ESPN fallback
  try {
    const sportMap = { NBA: "nba", NFL: "nfl", MLB: "mlb", NHL: "nhl" };
    const espnSport = sportMap[(sport || "").toUpperCase()] || "nba";
    const searchResp = await fetch(`https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(playerName)}&limit=1&type=player`);
    const searchData = await searchResp.json();
    const playerId = searchData.items?.[0]?.id;
    if (playerId) {
      return `https://a.espncdn.com/combiner/i?img=/i/headshots/${espnSport}/players/full/${playerId}.png&w=350&h=254`;
    }
  } catch {}

  return null;
}

// ── Story template segments ──
function getSegments(storyType) {
  const templates = {
    forgotten_legend: [
      { name: "hook", start: 0, end: 3, clipCategory: "action" },
      { name: "greatness", start: 3, end: 12, clipCategory: "action" },
      { name: "context", start: 12, end: 20, clipCategory: "era" },
      { name: "turn", start: 20, end: 32, clipCategory: "atmosphere" },
      { name: "forgotten", start: 32, end: 45, clipCategory: "stadium" },
      { name: "legacy", start: 45, end: 52, clipCategory: "stats" },
      { name: "kicker", start: 52, end: 55, clipCategory: "reaction" },
    ],
    record_breaker: [
      { name: "hook", start: 0, end: 3, clipCategory: "action" },
      { name: "context", start: 3, end: 10, clipCategory: "era" },
      { name: "build", start: 10, end: 22, clipCategory: "action" },
      { name: "record", start: 22, end: 35, clipCategory: "action" },
      { name: "attempts", start: 35, end: 45, clipCategory: "action" },
      { name: "stands", start: 45, end: 52, clipCategory: "stadium" },
      { name: "kicker", start: 52, end: 55, clipCategory: "reaction" },
    ],
  };
  return templates[storyType] || templates.forgotten_legend;
}

// ── Main pipeline ──
async function processScript(rowId) {
  console.log(`\n=== Processing ${rowId} ===`);

  // 1. Read script from KV
  const script = await kvGet(`lore:script:${rowId}`);
  if (!script) {
    console.error(`  Script not found for ${rowId}`);
    return { rowId, status: "not_found" };
  }

  console.log(`  Player: ${script.playerName} (${script.storyType})`);
  const segments = getSegments(script.storyType);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `clips-${rowId}-`));
  console.log(`  Temp dir: ${tmpDir}`);

  // 2. Claude plans clip slots
  console.log("  Asking Claude for clip plan...");
  const clipPlan = await askClaude(`You are sourcing video clips for a YouTube Short about ${script.playerName} (${script.playerSport}).

THE SCRIPT:
${script.hookLine || ""}
${script.script || ""}

I need a clip description for each of these segments. For each, provide a specific YouTube search query to find a SHORT clip of that SPECIFIC play/moment. Generate HYPER-SPECIFIC queries for single plays, not compilations.

SEGMENTS:
${segments.map((s, i) => `${i + 1}. [${s.start}s-${s.end}s] "${s.name}" (${s.clipCategory})`).join("\n")}

Return JSON:
{"clips":[{"slot":1,"search_query":"specific play search","clip_type":"gameplay"},...],"player_photo_search":"${script.playerName} portrait"}`, 1500);

  if (!clipPlan || !clipPlan.clips) {
    console.error("  Claude clip plan failed");
    return { rowId, status: "plan_failed" };
  }

  console.log(`  ${clipPlan.clips.length} clip slots planned`);

  // 3. Search YouTube for highlights
  const searchQueries = [...new Set(clipPlan.clips.map(c => c.search_query))].slice(0, 3);
  const allVideos = [];

  for (const query of searchQueries) {
    console.log(`  Searching: "${query.slice(0, 50)}..."`);
    const results = await searchYouTube(query, 5);
    const safe = results.filter(v => !isBlockedChannel(v.channelTitle));
    allVideos.push(...safe.slice(0, 2));
  }

  const uniqueVideos = [...new Map(allVideos.map(v => [v.videoId, v])).values()].slice(0, 5);
  console.log(`  Found ${uniqueVideos.length} safe source videos`);

  if (uniqueVideos.length === 0) {
    console.error("  No safe videos found");
    return { rowId, status: "no_videos", clipBriefs: [] };
  }

  // 4. Download a longer segment from the first video for scene detection
  const primaryVideo = uniqueVideos[0];
  const fullClipPath = path.join(tmpDir, "full_sample.mp4");
  console.log(`  Downloading sample from: ${primaryVideo.title.slice(0, 50)}...`);

  // Download first 3 minutes for scene detection
  const downloaded = downloadClip(primaryVideo.videoId, 10, 180, fullClipPath);
  let sceneTimes = [];

  if (downloaded) {
    console.log("  Running scene detection...");
    sceneTimes = detectScenes(fullClipPath);
    console.log(`  Found ${sceneTimes.length} scene boundaries`);
  }

  // 5. Download clips at scene boundaries (or fallback to intervals)
  const clipBriefs = [];
  const clipDuration = 2.5;
  const mood = script.storyType === "forgotten_legend" ? "nostalgic" :
               script.storyType === "record_breaker" ? "epic" : "dramatic";

  for (let i = 0; i < Math.min(clipPlan.clips.length, 7); i++) {
    const planned = clipPlan.clips[i];
    const seg = segments[i] || segments[segments.length - 1];
    const videoIdx = i % uniqueVideos.length;
    const video = uniqueVideos[videoIdx];

    // Pick a time: use scene boundary if available, otherwise evenly space
    let startTime;
    if (sceneTimes.length > 0 && videoIdx === 0) {
      // Pick from detected scenes, cycling through them
      startTime = sceneTimes[i % sceneTimes.length] + 10; // offset from sample start
    } else {
      // Evenly space across the video (assume 5 min = 300s)
      startTime = 15 + (i * 35) + Math.floor(Math.random() * 10);
    }

    const rawPath = path.join(tmpDir, `raw_${i}.mp4`);
    const transformedPath = path.join(tmpDir, `clip_${i}.mp4`);

    console.log(`  Clip ${i + 1}: downloading from ${video.videoId} at ${startTime}s...`);
    const ok = downloadClip(video.videoId, startTime, clipDuration, rawPath);

    if (!ok) {
      console.log(`  Clip ${i + 1}: download failed, skipping`);
      clipBriefs.push({
        slot: i + 1,
        start: seg.start,
        duration: seg.end - seg.start,
        segmentName: seg.name,
        clipType: planned.clip_type || "gameplay",
        searchQuery: planned.search_query,
        clipUrl: null,
        source: "none",
      });
      continue;
    }

    // 6. Transform
    const shouldMirror = Math.random() > 0.5;
    console.log(`  Clip ${i + 1}: transforming (mood=${mood}, mirror=${shouldMirror})...`);
    const transformed = transformClip(rawPath, transformedPath, mood, shouldMirror);

    if (!transformed) {
      console.log(`  Clip ${i + 1}: transform failed, skipping`);
      clipBriefs.push({
        slot: i + 1, start: seg.start, duration: seg.end - seg.start,
        segmentName: seg.name, clipType: planned.clip_type, searchQuery: planned.search_query,
        clipUrl: null, source: "none",
      });
      continue;
    }

    // 7. Upload to R2
    const r2Key = `${rowId}/clip_${i + 1}.mp4`;
    console.log(`  Clip ${i + 1}: uploading to R2 (${r2Key})...`);
    try {
      const clipUrl = await uploadToR2(transformedPath, r2Key);
      console.log(`  Clip ${i + 1}: ✓ ${clipUrl}`);
      clipBriefs.push({
        slot: i + 1,
        start: seg.start,
        duration: seg.end - seg.start,
        segmentName: seg.name,
        clipType: planned.clip_type || "gameplay",
        searchQuery: planned.search_query,
        clipUrl,
        source: "youtube_transformed",
        transforms: { mood, mirrored: shouldMirror, clipDuration },
      });
    } catch (e) {
      console.error(`  Clip ${i + 1}: R2 upload failed: ${e.message}`);
      clipBriefs.push({
        slot: i + 1, start: seg.start, duration: seg.end - seg.start,
        segmentName: seg.name, clipType: planned.clip_type, searchQuery: planned.search_query,
        clipUrl: null, source: "none",
      });
    }

    // Clean up raw file
    try { fs.unlinkSync(rawPath); } catch {}
  }

  // 8. Get player photo
  console.log("  Fetching player photo...");
  const playerPhotoUrl = await getPlayerImage(script.playerName, script.playerSport);
  console.log(`  Photo: ${playerPhotoUrl ? "found" : "not found"}`);

  // 9. Save to KV
  script.clipBriefs = clipBriefs;
  script.clipsSourced = clipBriefs.filter(c => c.clipUrl).length;
  script.clipSourceStatus = script.clipsSourced > 0 ? "GitHub Actions" : "Fallback";
  script.dateSourced = new Date().toISOString();
  if (playerPhotoUrl) script.playerPhotoUrl = playerPhotoUrl;

  await kvSet(`lore:script:${rowId}`, script);
  console.log(`  Saved: ${script.clipsSourced}/${clipBriefs.length} clips sourced`);

  // Clean up temp dir
  try { fs.rmSync(tmpDir, { recursive: true }); } catch {}

  return {
    rowId,
    status: "done",
    clipsSourced: script.clipsSourced,
    totalSlots: clipBriefs.length,
    playerPhoto: !!playerPhotoUrl,
  };
}

// ── Entry point ──
async function main() {
  const [, , batchId, rowIdsArg] = process.argv;

  if (!batchId) {
    console.error("Usage: node process-clips.js <batchId> <rowIds>");
    process.exit(1);
  }

  // Parse rowIds from JSON array or comma-separated string
  let rowIds;
  try {
    rowIds = JSON.parse(rowIdsArg);
  } catch {
    rowIds = (rowIdsArg || "").split(",").map(s => s.trim()).filter(Boolean);
  }

  if (rowIds.length === 0) {
    // Try to read from KV batch
    const batch = await kvGet(`lore:batch:${batchId}`);
    if (batch && batch.rowIds) {
      rowIds = batch.rowIds;
    } else {
      console.error("No rowIds provided and batch not found in KV");
      process.exit(1);
    }
  }

  console.log(`Batch: ${batchId}`);
  console.log(`Scripts: ${rowIds.length}`);
  console.log(`Env check: ANTHROPIC=${!!process.env.ANTHROPIC_API_KEY} YT=${!!process.env.YOUTUBE_API_KEY} KV=${!!process.env.KV_REST_API_URL} R2=${!!process.env.R2_ACCOUNT_ID}`);

  const results = [];
  for (const rowId of rowIds) {
    try {
      const result = await processScript(rowId);
      results.push(result);
    } catch (e) {
      console.error(`Failed ${rowId}: ${e.message}`);
      results.push({ rowId, status: "error", error: e.message });
    }
  }

  // Summary
  console.log("\n=== SUMMARY ===");
  const total = results.length;
  const success = results.filter(r => r.status === "done").length;
  const totalClips = results.reduce((sum, r) => sum + (r.clipsSourced || 0), 0);
  console.log(`Scripts: ${success}/${total} processed`);
  console.log(`Clips: ${totalClips} sourced`);
  results.forEach(r => console.log(`  ${r.rowId}: ${r.status} (${r.clipsSourced || 0} clips)`));

  if (success === 0) process.exit(1);
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
