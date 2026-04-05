/**
 * lib/lore/dashboard.js → GET/POST /api/lore?route=dashboard
 * Dashboard API for the Sports Lore admin interface.
 * Returns batch, script, and clip data for the frontend.
 */

const { getBatch, getBatchScripts, getScript } = require("./lib/kv-lore");
const kv = require("../../api/_kv");

// Helper to log API costs
async function logCost(service, amount, description) {
  try {
    let costs = await kv.get("lore:costs:log");
    costs = costs
      ? typeof costs === "string"
        ? JSON.parse(costs)
        : costs
      : [];
    costs.push({
      service,
      amount,
      description,
      date: new Date().toISOString(),
    });
    if (costs.length > 200) costs = costs.slice(-200);
    await kv.set("lore:costs:log", JSON.stringify(costs), 86400 * 90);
  } catch {}
}

module.exports = async function handler(req, res) {
  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const action = req.query.action || req.body?.action;

  // List recent batches
  if (action === "batches") {
    const batches = [];
    // Check last 8 weeks of batches (A and B halves)
    const now = new Date();
    for (let w = 0; w < 8; w++) {
      const d = new Date(now);
      d.setDate(d.getDate() - w * 7);
      const year = d.getFullYear();
      const weekNum = getWeekNumber(d);
      for (const half of ["A", "B"]) {
        const batchId = `${year}-W${String(weekNum).padStart(2, "0")}-${half}`;
        const batch = await getBatch(batchId);
        if (batch) {
          batches.push({ batchId, ...batch });
        }
      }
    }
    return res.status(200).json({ batches });
  }

  // Get scripts for a batch
  if (action === "scripts") {
    const batchId = req.query.batchId || req.body?.batchId;
    if (!batchId) return res.status(400).json({ error: "batchId required" });

    const scripts = await getBatchScripts(batchId);
    // Return summary (not full script text to keep response small)
    const summaries = scripts.map((s) => ({
      rowId: s.rowId,
      playerName: s.playerName,
      playerSport: s.playerSport,
      storyType: s.storyType,
      status: s.status,
      titleA: s.titleA,
      titleB: s.titleB,
      titleUsed: s.titleUsed,
      hookLine: s.hookLine,
      wordCount: (s.script || "").split(/\s+/).filter(Boolean).length,
      clipsSourced: s.clipsSourced || 0,
      clipsApproved: (s.clipBriefs || []).filter((c) => c.approved).length,
      clipsRejected: (s.clipBriefs || []).filter((c) => c.rejected).length,
      clipSourceStatus: s.clipSourceStatus,
      playerPhotoUrl: s.playerPhotoUrl,
      youtubeUrl: s.youtubeUrl,
      renderUrl: s.renderUrl,
      thumbnailUrl: s.thumbnailUrl,
      clipBriefCount: (s.clipBriefs || []).length,
      hasVoiceover: !!s.voiceoverUrl,
      musicMood: s.musicMood,
      viewsAt48h: s.viewsAt48h || null,
      retentionAt48h: s.retentionAt48h || null,
      hasScript: !!(s.script && s.script.length > 20),
      hasClips: (s.clipsSourced || 0) > 0,
      hasVoice: !!s.voiceoverUrl,
      hasRender: !!s.renderUrl,
      isPublished: !!s.youtubeUrl,
      titleUsed: s.titleUsed || null,
      versionCount: (s.scriptVersions || []).length,
    }));
    return res.status(200).json({ batchId, scripts: summaries });
  }

  // Get full script detail (including text and clip URLs)
  if (action === "script-detail") {
    const rowId = req.query.rowId || req.body?.rowId;
    if (!rowId) return res.status(400).json({ error: "rowId required" });

    const script = await getScript(rowId);
    if (!script) return res.status(404).json({ error: "Script not found" });

    return res.status(200).json({ script });
  }

  // Fetch player photo on-the-fly (Wikipedia → ESPN fallback)
  if (action === "player-photo") {
    const axios = require("axios");
    const name = req.query.name || req.body?.name;
    if (!name) return res.status(400).json({ error: "name required" });

    // Try Wikipedia with disambiguation variants
    const wikiHeaders = {
      "User-Agent": "SportsLoreDashboard/1.0 (contact@sportslore.com)",
    };
    const wikiNames = [
      name,
      `${name} (basketball)`,
      `${name} (basketball player)`,
    ];
    for (const wikiName of wikiNames) {
      try {
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(wikiName)}&prop=pageimages&format=json&pithumbsize=400`;
        const wikiResp = await axios.get(wikiUrl, {
          timeout: 5000,
          headers: wikiHeaders,
        });
        const pages = wikiResp.data?.query?.pages || {};
        for (const page of Object.values(pages)) {
          if (page.thumbnail?.source) {
            return res
              .status(200)
              .json({ url: page.thumbnail.source, source: "wikipedia" });
          }
        }
      } catch {}
    }

    // Try ESPN
    try {
      const espnResp = await axios.get(
        `https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}&limit=1&type=player`,
        { timeout: 5000 },
      );
      const playerId = espnResp.data?.items?.[0]?.id;
      if (playerId) {
        return res.status(200).json({
          url: `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${playerId}.png&w=350&h=254`,
          source: "espn",
        });
      }
    } catch (e) {
      console.error("ESPN photo error:", e.message);
    }

    return res.status(200).json({ url: null, source: "none" });
  }

  // Upload a replacement clip — receives a URL to fetch, not raw data
  // (Vercel has a 4.5MB body limit, so we can't receive video directly)
  if (action === "replace-clip" && req.method === "POST") {
    const { rowId, slot, clipUrl } = req.body || {};
    if (!rowId || !slot) {
      return res.status(400).json({ error: "rowId and slot required" });
    }

    try {
      // Update the script's clipBriefs in KV with the new URL
      const { saveScript } = require("./lib/kv-lore");
      const script = await getScript(rowId);
      if (!script) return res.status(404).json({ error: "Script not found" });

      const clipBriefs = script.clipBriefs || [];
      const existing = clipBriefs.find((c) => c.slot === parseInt(slot));
      if (existing) {
        existing.clipUrl = clipUrl || existing.clipUrl;
        existing.source = "manual_upload";
        existing.approved = true;
      } else {
        clipBriefs.push({
          slot: parseInt(slot),
          clipUrl: clipUrl || "",
          source: "manual_upload",
          approved: true,
        });
      }
      script.clipBriefs = clipBriefs;
      await saveScript(rowId, script);

      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Upload a clip directly to R2 (for small clips under 4MB)
  if (action === "upload-clip" && req.method === "POST") {
    const { rowId, slot, videoBase64 } = req.body || {};
    if (!rowId || !slot || !videoBase64) {
      return res
        .status(400)
        .json({ error: "rowId, slot, videoBase64 required" });
    }

    try {
      const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
      const client = new S3Client({
        region: "auto",
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });

      const buffer = Buffer.from(videoBase64, "base64");
      const key = `${rowId}/clip_${slot}.mp4`;
      await client.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME || "sports-lore-clips",
          Key: key,
          Body: buffer,
          ContentType: "video/mp4",
        }),
      );

      const publicUrl = `https://pub-86aa1c96eda04a8099526017d95dbb8f.r2.dev/${key}`;

      // Update KV
      const { saveScript } = require("./lib/kv-lore");
      const script = await getScript(rowId);
      if (script) {
        const clipBriefs = script.clipBriefs || [];
        const existing = clipBriefs.find((c) => c.slot === parseInt(slot));
        if (existing) {
          existing.clipUrl = publicUrl;
          existing.source = "manual_upload";
        } else {
          clipBriefs.push({
            slot: parseInt(slot),
            clipUrl: publicUrl,
            source: "manual_upload",
          });
        }
        script.clipBriefs = clipBriefs;
        await saveScript(rowId, script);
      }

      return res.status(200).json({ ok: true, url: publicUrl });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Approve a single clip
  if (action === "approve-clip" && req.method === "POST") {
    const { rowId, slot } = req.body || {};
    if (!rowId || slot == null)
      return res.status(400).json({ error: "rowId and slot required" });

    const { saveScript } = require("./lib/kv-lore");
    const script = await getScript(rowId);
    if (!script) return res.status(404).json({ error: "Script not found" });

    const clip = (script.clipBriefs || []).find(
      (c) => c.slot === parseInt(slot),
    );
    if (clip) {
      clip.approved = !clip.approved;
      if (clip.approved) {
        clip.rejected = false;
        clip.rejectionReason = null;
      }
    }
    await saveScript(rowId, script);
    return res.status(200).json({ ok: true, slot, approved: clip?.approved });
  }

  // Reject a single clip with reason
  if (action === "reject-clip" && req.method === "POST") {
    const { rowId, slot, reason } = req.body || {};
    if (!rowId || slot == null)
      return res.status(400).json({ error: "rowId and slot required" });

    const { saveScript, addRejection } = require("./lib/kv-lore");
    const script = await getScript(rowId);
    if (!script) return res.status(404).json({ error: "Script not found" });

    const clip = (script.clipBriefs || []).find(
      (c) => c.slot === parseInt(slot),
    );
    if (clip) {
      clip.approved = false;
      clip.rejected = true;
      clip.rejectionReason = reason || "unspecified";
    }
    script.clipsRejected = (script.clipsRejected || 0) + 1;
    if (reason) {
      script.rejectionReasons = [
        ...new Set([...(script.rejectionReasons || []), reason]),
      ];
    }
    await saveScript(rowId, script);

    // Also log to global rejection patterns
    try {
      await addRejection(rowId, [reason || "unspecified"]);
    } catch {}

    return res.status(200).json({ ok: true, slot, reason });
  }

  // Approve all clips for a script
  if (action === "approve-all" && req.method === "POST") {
    const { rowId } = req.body || {};
    if (!rowId) return res.status(400).json({ error: "rowId required" });

    const { saveScript } = require("./lib/kv-lore");
    const script = await getScript(rowId);
    if (!script) return res.status(404).json({ error: "Script not found" });

    let count = 0;
    for (const clip of script.clipBriefs || []) {
      if (clip.clipUrl && !clip.rejected) {
        clip.approved = true;
        count++;
      }
    }
    await saveScript(rowId, script);
    return res.status(200).json({ ok: true, approved: count });
  }

  // Get cost tracking data
  if (action === "cost-data") {
    const kv = require("../../api/_kv");
    const data = await kv.get("lore:costs:log");
    const costs = data
      ? typeof data === "string"
        ? JSON.parse(data)
        : data
      : [];
    return res.status(200).json({ costs });
  }

  // Log an API cost (called internally by other endpoints)
  if (action === "log-cost" && req.method === "POST") {
    const { service, amount, description } = req.body || {};
    if (!service || amount == null)
      return res.status(400).json({ error: "service and amount required" });

    const kv = require("../../api/_kv");
    let costs = await kv.get("lore:costs:log");
    costs = costs
      ? typeof costs === "string"
        ? JSON.parse(costs)
        : costs
      : [];
    costs.push({
      service,
      amount: parseFloat(amount),
      description,
      date: new Date().toISOString(),
    });
    // Keep last 200 entries
    if (costs.length > 200) costs = costs.slice(-200);
    await kv.set("lore:costs:log", JSON.stringify(costs), 86400 * 90);
    return res.status(200).json({ ok: true });
  }

  // Check VPS health
  if (action === "vps-health") {
    const clipApiUrl = process.env.CLIP_API_URL;
    if (!clipApiUrl) return res.status(200).json({ status: "not_configured" });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`${clipApiUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (resp.ok) {
        return res.status(200).json({ status: "online" });
      }
      return res.status(200).json({ status: "error", code: resp.status });
    } catch (e) {
      return res.status(200).json({ status: "offline", error: e.message });
    }
  }

  // Generate thumbnail options
  if (action === "generate-thumbnails" && req.method === "POST") {
    const { rowId } = req.body || {};
    if (!rowId) return res.status(400).json({ error: "rowId required" });

    const script = await getScript(rowId);
    if (!script) return res.status(404).json({ error: "Script not found" });

    // Build 4 thumbnail concepts using player photo + title text
    const playerPhoto = script.playerPhotoUrl || "";
    const titles =
      script.allTitles || [script.titleA, script.titleB].filter(Boolean);
    const thumbnails = titles.slice(0, 4).map((title, i) => ({
      id: i,
      title: title,
      playerPhoto,
      style: ["dramatic", "bold", "minimal", "retro"][i] || "dramatic",
    }));

    return res
      .status(200)
      .json({ thumbnails, playerPhoto, playerName: script.playerName });
  }

  // Set thumbnail URL
  if (action === "set-thumbnail" && req.method === "POST") {
    const { rowId, thumbnailUrl } = req.body || {};
    if (!rowId) return res.status(400).json({ error: "rowId required" });

    const { saveScript } = require("./lib/kv-lore");
    const script = await getScript(rowId);
    if (!script) return res.status(404).json({ error: "Script not found" });

    script.thumbnailUrl = thumbnailUrl;
    await saveScript(rowId, script);
    return res.status(200).json({ ok: true });
  }

  // Get YouTube comments for a script
  if (action === "get-comments") {
    const rowId = req.query.rowId || req.body?.rowId;
    if (!rowId) return res.status(400).json({ error: "rowId required" });

    const script = await getScript(rowId);
    if (!script || !script.youtubeVideoId)
      return res.status(200).json({ comments: [] });

    try {
      // Get OAuth access token
      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.YOUTUBE_CLIENT_ID,
          client_secret: process.env.YOUTUBE_CLIENT_SECRET,
          refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
          grant_type: "refresh_token",
        }),
      });
      const { access_token } = await tokenResp.json();
      if (!access_token)
        return res.status(200).json({ comments: [], error: "No access token" });

      const params = new URLSearchParams({
        part: "snippet",
        videoId: script.youtubeVideoId,
        maxResults: "20",
        order: "relevance",
      });
      const resp = await fetch(
        `https://www.googleapis.com/youtube/v3/commentThreads?${params}`,
        {
          headers: { Authorization: `Bearer ${access_token}` },
        },
      );
      const data = await resp.json();
      const comments = (data.items || []).map((item) => {
        const c = item.snippet.topLevelComment.snippet;
        return {
          id: item.id,
          author: c.authorDisplayName,
          authorPhoto: c.authorProfileImageUrl,
          text: c.textDisplay,
          likes: c.likeCount,
          published: c.publishedAt,
        };
      });
      return res.status(200).json({ comments });
    } catch (e) {
      return res.status(200).json({ comments: [], error: e.message });
    }
  }

  // Music presets — save/load named presets
  if (action === "music-presets") {
    const presets = await kv.get("lore:music:presets");
    return res.status(200).json({
      presets: presets
        ? typeof presets === "string"
          ? JSON.parse(presets)
          : presets
        : [],
    });
  }

  if (action === "save-music-preset" && req.method === "POST") {
    const { name, url, r2Url } = req.body || {};
    if (!name || !url)
      return res.status(400).json({ error: "name and url required" });

    let presets = await kv.get("lore:music:presets");
    presets = presets
      ? typeof presets === "string"
        ? JSON.parse(presets)
        : presets
      : [];
    const existing = presets.findIndex((p) => p.name === name);
    if (existing >= 0) {
      presets[existing] = {
        name,
        url,
        r2Url: r2Url || presets[existing].r2Url,
        savedAt: new Date().toISOString(),
      };
    } else {
      presets.push({ name, url, r2Url, savedAt: new Date().toISOString() });
    }
    await kv.set("lore:music:presets", JSON.stringify(presets), 86400 * 365);
    return res.status(200).json({ ok: true, presets });
  }

  // Cache music track to R2 and return public URL
  if (action === "cache-music" && req.method === "POST") {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: "url required" });

    try {
      // Generate a stable key from the URL
      const key = `music/${Buffer.from(url).toString("base64url").slice(0, 40)}.mp3`;
      const publicUrl = `https://pub-86aa1c96eda04a8099526017d95dbb8f.r2.dev/${key}`;

      // Check if already cached by trying a HEAD request
      try {
        const check = await fetch(publicUrl, { method: "HEAD" });
        if (check.ok) return res.status(200).json({ ok: true, url: publicUrl });
      } catch {}

      // Download from source
      const resp = await fetch(url, { redirect: "follow" });
      if (!resp.ok)
        return res
          .status(500)
          .json({ error: `Source returned ${resp.status}` });
      const buffer = Buffer.from(await resp.arrayBuffer());

      // Upload to R2
      const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
      const client = new S3Client({
        region: "auto",
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });
      await client.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME || "sports-lore-clips",
          Key: key,
          Body: buffer,
          ContentType: "audio/mpeg",
        }),
      );

      return res.status(200).json({ ok: true, url: publicUrl });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Get analytics data for dashboard
  if (action === "analytics-data") {
    const kv = require("../../api/_kv");
    const weeks = [];
    const now = new Date();
    for (let w = 0; w < 8; w++) {
      const d = new Date(now);
      d.setDate(d.getDate() - w * 7);
      const weekOf = d.toISOString().split("T")[0];
      const data = await kv.get(`lore:analytics:${weekOf}`);
      if (data) {
        try {
          const parsed = typeof data === "string" ? JSON.parse(data) : data;
          weeks.push({ weekOf, ...parsed });
        } catch {}
      }
    }
    return res.status(200).json({ weeks });
  }

  // Inline edit script fields (hookLine, script, commentBait)
  if (action === "edit-script" && req.method === "POST") {
    const { rowId, field, value } = req.body || {};
    if (!rowId || !field || value == null)
      return res.status(400).json({ error: "rowId, field, value required" });

    const allowed = [
      "hookLine",
      "script",
      "commentBait",
      "titleA",
      "titleB",
      "scheduledDate",
      "scheduledPostTime",
      "musicTrack",
      "musicMood",
    ];
    if (!allowed.includes(field))
      return res
        .status(400)
        .json({ error: `Invalid field. Allowed: ${allowed.join(", ")}` });

    const { saveScript } = require("./lib/kv-lore");
    const script = await getScript(rowId);
    if (!script) return res.status(404).json({ error: "Script not found" });

    script[field] = value;
    await saveScript(rowId, script);
    return res.status(200).json({
      ok: true,
      field,
      wordCount: (script.script || "").split(/\s+/).filter(Boolean).length,
    });
  }

  // Regenerate script with user suggestion
  if (action === "regen-script" && req.method === "POST") {
    const { rowId, suggestion } = req.body || {};
    if (!rowId) return res.status(400).json({ error: "rowId required" });

    const { saveScript } = require("./lib/kv-lore");
    const script = await getScript(rowId);
    if (!script) return res.status(404).json({ error: "Script not found" });

    // Save current version before overwriting
    if (!script.scriptVersions) script.scriptVersions = [];
    script.scriptVersions.push({
      script: script.script,
      hookLine: script.hookLine,
      titleA: script.titleA,
      titleB: script.titleB,
      commentBait: script.commentBait,
      savedAt: new Date().toISOString(),
    });
    // Keep last 5 versions
    if (script.scriptVersions.length > 5)
      script.scriptVersions = script.scriptVersions.slice(-5);

    try {
      const { askClaudeJSON } = require("./lib/claude");
      const result = await askClaudeJSON(
        `You are rewriting a YouTube Shorts script about ${script.playerName} (${script.playerSport}, ${script.storyType}).

CURRENT SCRIPT:
Hook: "${script.hookLine || ""}"
Script: "${script.script || ""}"
Title A: "${script.titleA || ""}"
Title B: "${script.titleB || ""}"
Comment Bait: "${script.commentBait || ""}"

USER FEEDBACK: "${suggestion || "Make it better"}"

Rewrite the script incorporating the user's feedback.

CRITICAL RULES:
- ABSOLUTE MAX: 110 words (voiceover must be under 59 seconds — ElevenLabs speaks at ~1.9 words/sec with pauses). Count every word carefully. Aim for 100-110 words.
- Do NOT reference obscure/old NBA players by name — viewers won't know them. Only reference widely known names (LeBron, Jordan, Shaq, Kobe, Curry) for brief context.
- Keep the structure: scroll-stopping hook → narrative → closing question that loops back to the opening.
- Closing question must recontextualize the opening when the video auto-replays.

Return JSON:
{"hookLine":"...","script":"...","titles":["title1","title2","title3","title4","title5"],"commentBait":"..."}`,
        { maxTokens: 1500 },
      );
      script.script = result.script || script.script;
      script.hookLine = result.hookLine || script.hookLine;
      // Store all 5 titles; user picks top 2 for A/B
      if (result.titles && result.titles.length >= 2) {
        script.allTitles = result.titles;
        script.titleA = result.titles[0];
        script.titleB = result.titles[1];
      } else {
        script.titleA = result.titleA || script.titleA;
        script.titleB = result.titleB || script.titleB;
      }
      script.commentBait = result.commentBait || script.commentBait;
      script.lastRegenSuggestion = suggestion;
      script.lastRegenAt = new Date().toISOString();

      await saveScript(rowId, script);
      await logCost("Claude", 0.03, `Regen script: ${script.playerName}`);
      return res.status(200).json({ ok: true, script });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Revert script to previous version
  if (action === "revert-script" && req.method === "POST") {
    const { rowId, versionIdx } = req.body || {};
    if (!rowId) return res.status(400).json({ error: "rowId required" });

    const { saveScript } = require("./lib/kv-lore");
    const script = await getScript(rowId);
    if (!script) return res.status(404).json({ error: "Script not found" });

    const versions = script.scriptVersions || [];
    const idx = versionIdx != null ? versionIdx : versions.length - 1;
    const ver = versions[idx];
    if (!ver) return res.status(400).json({ error: "No previous version" });

    // Save current as a version before reverting
    versions.push({
      script: script.script,
      hookLine: script.hookLine,
      titleA: script.titleA,
      titleB: script.titleB,
      commentBait: script.commentBait,
      savedAt: new Date().toISOString(),
    });
    if (versions.length > 5) script.scriptVersions = versions.slice(-5);

    script.script = ver.script;
    script.hookLine = ver.hookLine;
    script.titleA = ver.titleA;
    script.titleB = ver.titleB;
    script.commentBait = ver.commentBait;

    await saveScript(rowId, script);
    return res.status(200).json({ ok: true, script });
  }

  // Generate 5 title options for a script
  if (action === "generate-titles" && req.method === "POST") {
    const { rowId } = req.body || {};
    if (!rowId) return res.status(400).json({ error: "rowId required" });

    const script = await getScript(rowId);
    if (!script) return res.status(404).json({ error: "Script not found" });

    try {
      const { askClaudeJSON } = require("./lib/claude");
      const result =
        await askClaudeJSON(`Generate 5 YouTube Shorts title options for this sports story.

Player: ${script.playerName} (${script.playerSport})
Story type: ${script.storyType}
Hook: "${script.hookLine || ""}"
Script summary: "${(script.script || "").slice(0, 200)}"

Rules:
- Each title must be under 60 characters
- Mix styles: curiosity gap, bold claim, shocking stat, question, controversy
- Optimized for YouTube Shorts click-through rate
- Include the player name or a recognizable reference

Return JSON: {"titles":["title1","title2","title3","title4","title5"]}`);
      const titles = result.titles || [];
      if (titles.length < 2)
        return res.status(500).json({ error: "Too few titles" });

      const { saveScript } = require("./lib/kv-lore");
      script.allTitles = titles;
      script.titleA = titles[0];
      script.titleB = titles[1];
      await saveScript(rowId, script);

      await logCost("Claude", 0.02, `Titles: ${script.playerName}`);
      return res.status(200).json({ ok: true, titles });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Upload player photo
  if (action === "upload-photo" && req.method === "POST") {
    const { rowId, imageBase64 } = req.body || {};
    if (!rowId || !imageBase64)
      return res.status(400).json({ error: "rowId and imageBase64 required" });

    try {
      const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
      const client = new S3Client({
        region: "auto",
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });

      // Detect format from base64 header
      const isJpeg = imageBase64.startsWith("/9j/");
      const ext = isJpeg ? "jpg" : "png";
      const contentType = isJpeg ? "image/jpeg" : "image/png";
      const buffer = Buffer.from(imageBase64, "base64");
      const key = `${rowId}/player.${ext}`;

      await client.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME || "sports-lore-clips",
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );

      const publicUrl = `https://pub-86aa1c96eda04a8099526017d95dbb8f.r2.dev/${key}`;

      // Save to KV
      const { saveScript } = require("./lib/kv-lore");
      const script = await getScript(rowId);
      if (script) {
        script.playerPhotoUrl = publicUrl;
        await saveScript(rowId, script);
      }

      return res.status(200).json({ ok: true, url: publicUrl });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Update title A/B selection or set which titles to use for A/B
  if (action === "update-title" && req.method === "POST") {
    const { rowId, titleUsed, titleA, titleB } = req.body || {};
    if (!rowId) return res.status(400).json({ error: "rowId required" });

    const { saveScript } = require("./lib/kv-lore");
    const script = await getScript(rowId);
    if (!script) return res.status(404).json({ error: "Script not found" });

    if (titleA) script.titleA = titleA;
    if (titleB) script.titleB = titleB;
    if (titleUsed) script.titleUsed = titleUsed;
    await saveScript(rowId, script);
    return res.status(200).json({
      ok: true,
      titleA: script.titleA,
      titleB: script.titleB,
      titleUsed: script.titleUsed,
    });
  }

  // Save clip order to KV
  if (action === "save-clip-order" && req.method === "POST") {
    const { rowId, order } = req.body || {};
    if (!rowId || !order)
      return res.status(400).json({ error: "rowId and order required" });

    const { saveScript } = require("./lib/kv-lore");
    const script = await getScript(rowId);
    if (!script) return res.status(404).json({ error: "Script not found" });

    // order is an array of slot numbers in the new display order
    // e.g. [3, 1, 2, 4, ...] means slot 3 plays first, then slot 1, etc.
    script.clipDisplayOrder = order;
    await saveScript(rowId, script);
    return res.status(200).json({ ok: true });
  }

  // Update script status
  if (action === "update-status" && req.method === "POST") {
    const { rowId, status } = req.body || {};
    if (!rowId || !status)
      return res.status(400).json({ error: "rowId and status required" });

    const validStatuses = ["Pending", "Review", "Ready", "Paused"];
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ error: `Invalid status. Valid: ${validStatuses.join(", ")}` });
    }

    const { saveScript } = require("./lib/kv-lore");
    const script = await getScript(rowId);
    if (!script) return res.status(404).json({ error: "Script not found" });

    script.status = status;
    await saveScript(rowId, script);
    return res.status(200).json({ ok: true, status });
  }

  // Search YouTube for clips
  if (action === "youtube-search") {
    const query = req.query.q || req.body?.q;
    if (!query) return res.status(400).json({ error: "q (query) required" });

    try {
      // Try API key first, then fall back to OAuth access token
      let accessToken = null;
      let useKey = !!process.env.YOUTUBE_API_KEY;

      if (!useKey) {
        // Get OAuth access token from refresh token
        const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.YOUTUBE_CLIENT_ID,
            client_secret: process.env.YOUTUBE_CLIENT_SECRET,
            refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
            grant_type: "refresh_token",
          }),
        });
        const tokenData = await tokenResp.json();
        accessToken = tokenData.access_token;
        if (!accessToken)
          return res
            .status(500)
            .json({ error: "Failed to get YouTube access token" });
      }

      const params = new URLSearchParams({
        part: "snippet",
        q: query,
        type: "video",
        maxResults: "8",
        videoDuration: "medium",
      });
      if (useKey) params.set("key", process.env.YOUTUBE_API_KEY);

      const headers = {};
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const resp = await fetch(
        `https://www.googleapis.com/youtube/v3/search?${params}`,
        { headers },
      );
      const data = await resp.json();

      if (data.error) {
        const errMsg =
          data.error.message || JSON.stringify(data.error).slice(0, 200);
        return res.status(500).json({ error: `YouTube: ${errMsg}` });
      }

      const results = (data.items || []).map((item) => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        channel: item.snippet.channelTitle,
        thumbnail:
          item.snippet.thumbnails?.medium?.url ||
          item.snippet.thumbnails?.default?.url,
        published: item.snippet.publishedAt,
      }));
      return res.status(200).json({ results });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Download a clip segment from YouTube via VPS and upload to R2
  if (action === "clip-from-youtube" && req.method === "POST") {
    const { rowId, slot, videoId, startTime, duration } = req.body || {};
    if (!rowId || !slot || !videoId)
      return res.status(400).json({ error: "rowId, slot, videoId required" });

    const clipApiUrl = process.env.CLIP_API_URL;
    const clipApiSecret = process.env.CLIP_API_SECRET;
    if (!clipApiUrl)
      return res.status(500).json({ error: "CLIP_API_URL not configured" });

    try {
      // Download clip from VPS
      const clipResp = await fetch(`${clipApiUrl}/download-clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          startTime: startTime || 0,
          duration: duration || 3,
          secret: clipApiSecret,
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!clipResp.ok) {
        const err = await clipResp.text();
        return res
          .status(500)
          .json({ error: `VPS error: ${err.slice(0, 150)}` });
      }

      const buffer = Buffer.from(await clipResp.arrayBuffer());

      // Upload to R2
      const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
      const client = new S3Client({
        region: "auto",
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });

      const key = `${rowId}/clip_${slot}.mp4`;
      await client.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME || "sports-lore-clips",
          Key: key,
          Body: buffer,
          ContentType: "video/mp4",
        }),
      );

      const publicUrl = `https://pub-86aa1c96eda04a8099526017d95dbb8f.r2.dev/${key}`;

      // Update KV
      const { saveScript } = require("./lib/kv-lore");
      const script = await getScript(rowId);
      if (script) {
        const clipBriefs = script.clipBriefs || [];
        const existing = clipBriefs.find((c) => c.slot === parseInt(slot));
        if (existing) {
          existing.clipUrl = publicUrl;
          existing.source = "youtube_manual";
          existing.approved = false;
          existing.rejected = false;
          existing.youtubeVideoId = videoId;
          existing.youtubeStartTime = startTime;
        } else {
          clipBriefs.push({
            slot: parseInt(slot),
            clipUrl: publicUrl,
            source: "youtube_manual",
            youtubeVideoId: videoId,
            youtubeStartTime: startTime,
          });
        }
        script.clipBriefs = clipBriefs;
        await saveScript(rowId, script);
      }

      return res.status(200).json({ ok: true, url: publicUrl });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Clip library — save a clip
  if (action === "save-clip-library" && req.method === "POST") {
    const { name, playerName, url, source } = req.body || {};
    if (!name || !url)
      return res.status(400).json({ error: "name and url required" });

    let library = await kv.get("lore:clip-library");
    library = library
      ? typeof library === "string"
        ? JSON.parse(library)
        : library
      : [];
    library.push({
      name,
      playerName: playerName || "",
      url,
      source: source || "",
      savedAt: new Date().toISOString(),
    });
    if (library.length > 500) library = library.slice(-500);
    await kv.set("lore:clip-library", JSON.stringify(library), 86400 * 365);
    return res.status(200).json({ ok: true });
  }

  // Clip library — list clips (optionally filtered by player)
  if (action === "clip-library") {
    let library = await kv.get("lore:clip-library");
    library = library
      ? typeof library === "string"
        ? JSON.parse(library)
        : library
      : [];
    const playerName = req.query.playerName || req.body?.playerName;
    if (playerName) {
      const playerClips = library.filter((c) => c.playerName === playerName);
      const otherClips = library.filter((c) => c.playerName !== playerName);
      return res.status(200).json({ clips: [...playerClips, ...otherClips] });
    }
    return res.status(200).json({ clips: library });
  }

  // Upload custom voiceover audio
  if (action === "upload-voiceover" && req.method === "POST") {
    const { rowId, audioBase64, fileName } = req.body || {};
    if (!rowId || !audioBase64)
      return res.status(400).json({ error: "rowId and audioBase64 required" });

    try {
      const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
      const client = new S3Client({
        region: "auto",
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });

      const ext = (fileName || "").split(".").pop() || "mp3";
      const buffer = Buffer.from(audioBase64, "base64");
      const key = `${rowId}/voiceover.${ext}`;
      await client.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME || "sports-lore-clips",
          Key: key,
          Body: buffer,
          ContentType: ext === "wav" ? "audio/wav" : "audio/mpeg",
        }),
      );

      const publicUrl = `https://pub-86aa1c96eda04a8099526017d95dbb8f.r2.dev/${key}`;

      const { saveScript } = require("./lib/kv-lore");
      const script = await getScript(rowId);
      if (script) {
        script.voiceoverUrl = publicUrl;

        // Generate proportional word timestamps from script text + audio duration
        const duration = req.body.duration;
        if (duration && script.script) {
          script.voiceoverDuration = parseFloat(duration);
          const fullText =
            (script.hookLine ? script.hookLine + ". " : "") + script.script;
          const words = fullText.split(/\s+/).filter(Boolean);
          const secPerWord = parseFloat(duration) / words.length;
          script.voiceoverTimestamps = words.map((word, i) => ({
            word,
            start: parseFloat((i * secPerWord).toFixed(3)),
            end: parseFloat(((i + 1) * secPerWord).toFixed(3)),
          }));
        } else {
          script.voiceoverTimestamps = null;
          script.voiceoverDuration = null;
        }
        await saveScript(rowId, script);
      }

      return res
        .status(200)
        .json({ ok: true, url: publicUrl, duration: req.body.duration });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Generate voiceover via ElevenLabs
  if (action === "generate-voiceover" && req.method === "POST") {
    const { rowId } = req.body || {};
    if (!rowId) return res.status(400).json({ error: "rowId required" });

    const { saveScript } = require("./lib/kv-lore");
    const script = await getScript(rowId);
    if (!script) return res.status(404).json({ error: "Script not found" });

    const fullText =
      (script.hookLine ? script.hookLine + ". " : "") + (script.script || "");
    if (!fullText.trim())
      return res.status(400).json({ error: "Script has no text" });

    try {
      const { generateVoiceover } = require("./lib/elevenlabs");
      const TARGET_MAX = 59; // stay under 60s for Shorts

      // First attempt at normal speed
      let result = await generateVoiceover(fullText);
      if (!result)
        return res
          .status(500)
          .json({ error: "ElevenLabs API key not configured" });

      // If too long, retry with speed-up calculated to hit ~58s
      if (result.audioDuration && result.audioDuration > TARGET_MAX) {
        const speedUp = result.audioDuration / (TARGET_MAX - 1); // e.g. 65s / 58s = 1.12x
        const clampedSpeed = Math.min(speedUp, 1.3); // don't go above 1.3x or it sounds unnatural
        result = await generateVoiceover(fullText, { speed: clampedSpeed });
        await logCost(
          "ElevenLabs",
          0.3,
          `Voiceover retry ${clampedSpeed.toFixed(2)}x: ${script.playerName}`,
        );
      }

      script.voiceoverUrl = result.url;
      script.voiceoverTimestamps = result.wordTimestamps;
      script.voiceoverDuration = result.audioDuration;
      script.voiceoverSpeed =
        result.audioDuration > TARGET_MAX ? null : result.speed || 1.0;
      await saveScript(rowId, script);
      await logCost(
        "ElevenLabs",
        0.3,
        `Voiceover: ${script.playerName} (${result.audioDuration?.toFixed(1)}s)`,
      );

      return res
        .status(200)
        .json({ ok: true, url: result.url, duration: result.audioDuration });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Trigger GitHub Actions clip pipeline
  if (action === "trigger-clips" && req.method === "POST") {
    const { batchId, rowIds } = req.body || {};
    if (!batchId) return res.status(400).json({ error: "batchId required" });

    const ghToken = process.env.GITHUB_PAT;
    if (!ghToken)
      return res.status(500).json({ error: "GITHUB_PAT not configured" });

    try {
      const resp = await fetch(
        "https://api.github.com/repos/juhtinc/prizepicks-edge/dispatches",
        {
          method: "POST",
          headers: {
            Authorization: `token ${ghToken}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            event_type: "source-clips",
            client_payload: { batchId, rowIds: rowIds || [] },
          }),
        },
      );

      if (resp.status === 204) {
        return res
          .status(200)
          .json({ ok: true, message: "Pipeline triggered" });
      } else {
        const err = await resp.text();
        return res
          .status(resp.status)
          .json({ error: `GitHub API: ${err.slice(0, 200)}` });
      }
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Check GitHub Actions run status
  if (action === "pipeline-status") {
    const ghToken = process.env.GITHUB_PAT;
    if (!ghToken) return res.status(200).json({ runs: [] });

    try {
      const resp = await fetch(
        "https://api.github.com/repos/juhtinc/prizepicks-edge/actions/runs?per_page=5&event=repository_dispatch",
        {
          headers: {
            Authorization: `token ${ghToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        },
      );
      const data = await resp.json();
      const runs = (data.workflow_runs || []).map((r) => ({
        id: r.id,
        status: r.status,
        conclusion: r.conclusion,
        created: r.created_at,
        url: r.html_url,
      }));
      return res.status(200).json({ runs });
    } catch (e) {
      return res.status(200).json({ runs: [], error: e.message });
    }
  }

  return res.status(400).json({
    error: "action required",
    available: [
      "batches",
      "scripts",
      "script-detail",
      "player-photo",
      "replace-clip",
      "upload-clip",
      "approve-clip",
      "reject-clip",
      "approve-all",
      "update-status",
      "trigger-clips",
      "pipeline-status",
    ],
  });
};

function getWeekNumber(date) {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}
