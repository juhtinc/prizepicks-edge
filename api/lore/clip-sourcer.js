/**
 * api/lore/clip-sourcer.js  →  POST /api/lore/clip-sourcer
 * Feature #5: Source REAL player footage from YouTube highlights.
 *
 * Pipeline:
 *   1. Claude identifies what clips to show at each script timestamp
 *   2. Scraper searches YouTube for player highlight compilations
 *   3. yt-dlp downloads 2-4 second segments from those videos
 *   4. FFmpeg transforms each clip (crop, zoom, speed, color grade, mirror)
 *   5. Transformed clips are uploaded to cloud storage
 *   6. Stat overlays are generated for key moments
 *   7. All data saved to KV for the Creatomate render step
 *
 * Falls back to Pexels stock footage if yt-dlp is not available.
 *
 * Body: { rowId } or { batchId }
 * Auth: x-secret header
 */

const axios = require("axios");
const { askClaudeJSON } = require("./lib/claude");
const { getScript, saveScript, getBatchScripts, getRejectionPatterns } = require("./lib/kv-lore");
const { calculateClipSlots, getStoryTemplate } = require("./lib/story-templates");
const { scrapePlayerClips, searchPlayerPhoto } = require("./lib/clip-scraper");
const { transformClipBatch, uploadTransformedClips } = require("./lib/clip-transformer");
const { generateStatOverlays, statOverlaysToCreatomate } = require("./lib/stat-overlays");

/**
 * Check if yt-dlp is available on the system.
 */
function isYtDlpAvailable() {
  try {
    require("child_process").execSync(
      `${process.env.YT_DLP_PATH || "yt-dlp"} --version`,
      { stdio: "pipe", timeout: 5000 }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Fallback: use Pexels for stock footage when yt-dlp isn't available.
 */
async function pexelsFallback(searchTerm) {
  const pexelsKey = process.env.PEXELS_API_KEY;
  if (!pexelsKey) return null;

  try {
    const resp = await axios.get("https://api.pexels.com/videos/search", {
      headers: { Authorization: pexelsKey },
      params: { query: searchTerm, per_page: 3, size: "medium", orientation: "portrait" },
    });
    const video = resp.data?.videos?.[0];
    if (video) {
      const file = video.video_files.find(f => f.quality === "hd" && f.width <= 1080)
        || video.video_files.find(f => f.quality === "hd")
        || video.video_files[0];
      return file?.link || null;
    }
  } catch (e) {
    console.error("[clip-sourcer] Pexels fallback error:", e.message);
  }
  return null;
}

async function sourceClipsForScript(script, rejectionPatterns) {
  const template = getStoryTemplate(script.storyType);
  const clipSlots = calculateClipSlots(script.storyType);
  const useRealFootage = isYtDlpAvailable();

  // Step 1: Ask Claude what clips to show at each timestamp
  const patternWarning = Object.entries(rejectionPatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => `${reason} (${count}x)`)
    .join(", ");

  const segmentGuide = template.segments.map(seg =>
    `[${seg.start}s-${seg.end}s] "${seg.name}" — ${seg.description} (${seg.clipCategory} clips)`
  ).join("\n");

  const prompt = `You are sourcing video clips for a YouTube Short about ${script.playerName} (${script.playerSport}).

THE SCRIPT:
${script.script}

VIDEO SEGMENTS:
${segmentGuide}

I need a clip description for each of these ${clipSlots.length} time slots.

CRITICAL: Generate HYPER-SPECIFIC YouTube search queries for single plays, not compilations.
BAD:  "Michael Jordan highlights" (returns 10-min compilations, can't find the right moment)
GOOD: "Michael Jordan free throw line dunk 1988 slam dunk contest" (returns short clip of that exact play)
GOOD: "Michael Jordan 63 points Celtics 1986 game winner" (returns that specific moment)

For each slot:
1. What the viewer should SEE (matched to what the voiceover says at this timestamp)
2. A YouTube search query for a SHORT clip of that SPECIFIC play/moment
3. Type: "gameplay" (real game footage), "photo" (still image with Ken Burns), or "graphic" (stat overlay)

CLIP SLOTS:
${clipSlots.map((slot, i) => `Slot ${i + 1}: [${slot.start}s-${(slot.start + slot.duration).toFixed(1)}s] segment="${slot.segmentName}"`).join("\n")}

${patternWarning ? `AVOID: ${patternWarning}.` : ""}

Return JSON:
{"clips":[{"slot":1,"visual":"what viewer sees","search_query":"specific play search","clip_type":"gameplay|photo|graphic","matches_script":"quote from script"},...],"player_photo_search":"${script.playerName} ${script.playerSport} portrait"}`;

  const clipPlan = await askClaudeJSON(prompt, { maxTokens: 2000 });

  // Step 2: Source clips based on availability
  const clipBriefs = [];

  if (useRealFootage) {
    // ── REAL FOOTAGE PATH ──
    // Scrape actual highlight clips from YouTube
    const gameplaySlots = (clipPlan.clips || []).filter(c => c.clip_type === "gameplay");
    const numClips = Math.min(gameplaySlots.length, 12); // Cap at 12 real clips

    const { clips: scrapedClips, outputDir } = await scrapePlayerClips(
      script.playerName,
      script.playerSport,
      numClips,
      { team: script.team, clipDuration: 3 }
    );

    // Transform all scraped clips
    const mood = template.musicMoods?.primary || "dramatic";
    const transformed = transformClipBatch(scrapedClips, mood, outputDir);
    const uploaded = await uploadTransformedClips(transformed);

    // Map transformed clips to their slots
    let realClipIndex = 0;
    for (const planned of clipPlan.clips || []) {
      const slot = clipSlots[planned.slot - 1];
      if (!slot) continue;

      let clipUrl = null;
      let source = "none";

      if (planned.clip_type === "gameplay" && realClipIndex < uploaded.length) {
        clipUrl = uploaded[realClipIndex]?.url;
        source = clipUrl ? "youtube_transformed" : "none";
        realClipIndex++;
      } else if (planned.clip_type === "photo") {
        // Photos are handled by Creatomate with Ken Burns — pass the search query
        source = "photo";
      } else if (planned.clip_type === "graphic") {
        // Graphics are stat overlays — handled separately
        source = "graphic";
      }

      clipBriefs.push({
        slot: planned.slot,
        start: slot.start,
        duration: slot.duration,
        segmentName: slot.segmentName,
        visual: planned.visual,
        searchQuery: planned.search_query,
        clipType: planned.clip_type,
        matchesScript: planned.matches_script,
        clipUrl,
        source,
        transforms: uploaded[realClipIndex - 1]?.transforms || null,
      });
    }
  } else {
    // ── PEXELS FALLBACK PATH ──
    for (const planned of clipPlan.clips || []) {
      const slot = clipSlots[planned.slot - 1];
      if (!slot) continue;

      const clipUrl = await pexelsFallback(planned.search_query);

      clipBriefs.push({
        slot: planned.slot,
        start: slot.start,
        duration: slot.duration,
        segmentName: slot.segmentName,
        visual: planned.visual,
        searchQuery: planned.search_query,
        clipType: planned.clip_type,
        matchesScript: planned.matches_script,
        clipUrl,
        source: clipUrl ? "pexels" : "none",
        transforms: null,
      });
    }
  }

  // Step 3: Generate stat overlays
  let statOverlays = [];
  try {
    statOverlays = await generateStatOverlays(
      script.script,
      script.playerName,
      script.playerSport,
      template.segments
    );
  } catch (e) {
    console.error("[clip-sourcer] Stat overlay generation failed:", e.message);
  }

  // Step 4: Get player photo for thumbnail + photo slots
  let playerPhotoUrl = "";
  try {
    playerPhotoUrl = await searchPlayerPhoto(script.playerName, script.playerSport) || "";
  } catch (e) {
    console.error("[clip-sourcer] Player photo search failed:", e.message);
  }

  return { clipBriefs, statOverlays, playerPhotoSearch: playerPhotoUrl };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId, batchId } = req.body || {};
  const rejectionPatterns = await getRejectionPatterns();

  if (batchId) {
    const scripts = await getBatchScripts(batchId);
    if (!scripts.length) return res.status(404).json({ error: "No scripts in batch" });

    const results = await Promise.all(
      scripts.map(async (script) => {
        const { clipBriefs, statOverlays, playerPhotoSearch } = await sourceClipsForScript(script, rejectionPatterns);
        script.clipBriefs = clipBriefs;
        script.statOverlays = statOverlays;
        script.clipsSourced = clipBriefs.filter(c => c.clipUrl).length;
        script.clipSourceStatus = script.clipsSourced > 0 ? "Auto-sourced" : "Manual";
        script.dateSourced = new Date().toISOString();
        script.playerPhotoUrl = playerPhotoSearch;
        await saveScript(script.rowId, script);
        return {
          rowId: script.rowId,
          clipsSourced: script.clipsSourced,
          totalSlots: clipBriefs.length,
          statOverlays: statOverlays.length,
          source: clipBriefs[0]?.source || "none",
        };
      })
    );

    return res.status(200).json({ ok: true, batchId, results });
  }

  if (!rowId) return res.status(400).json({ error: "rowId or batchId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  const { clipBriefs, statOverlays, playerPhotoSearch } = await sourceClipsForScript(script, rejectionPatterns);
  script.clipBriefs = clipBriefs;
  script.statOverlays = statOverlays;
  script.clipsSourced = clipBriefs.filter(c => c.clipUrl).length;
  script.clipSourceStatus = script.clipsSourced > 0 ? "Auto-sourced" : "Manual";
  script.dateSourced = new Date().toISOString();
  script.playerPhotoUrl = playerPhotoSearch;
  await saveScript(rowId, script);

  return res.status(200).json({ ok: true, rowId, clipBriefs, statOverlays });
};
