/**
 * lib/lore/dashboard.js → GET/POST /api/lore?route=dashboard
 * Dashboard API for the Sports Lore admin interface.
 * Returns batch, script, and clip data for the frontend.
 */

const { getBatch, getBatchScripts, getScript } = require("./lib/kv-lore");
const kv = require("../../api/_kv");

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
    const summaries = scripts.map(s => ({
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
      clipSourceStatus: s.clipSourceStatus,
      playerPhotoUrl: s.playerPhotoUrl,
      youtubeUrl: s.youtubeUrl,
      renderUrl: s.renderUrl,
      thumbnailUrl: s.thumbnailUrl,
      clipBriefCount: (s.clipBriefs || []).length,
      hasVoiceover: !!s.voiceoverUrl,
      musicMood: s.musicMood,
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

    // Try Wikipedia
    try {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(name)}&prop=pageimages&format=json&pithumbsize=400`;
      const wikiResp = await axios.get(wikiUrl, { timeout: 5000 });
      const pages = wikiResp.data?.query?.pages || {};
      for (const page of Object.values(pages)) {
        if (page.thumbnail?.source) {
          return res.status(200).json({ url: page.thumbnail.source, source: "wikipedia" });
        }
      }
    } catch (e) { console.error("Wiki photo error:", e.message); }

    // Try ESPN
    try {
      const espnResp = await axios.get(`https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}&limit=1&type=player`, { timeout: 5000 });
      const playerId = espnResp.data?.items?.[0]?.id;
      if (playerId) {
        return res.status(200).json({
          url: `https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/${playerId}.png&w=350&h=254`,
          source: "espn",
        });
      }
    } catch (e) { console.error("ESPN photo error:", e.message); }

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
      const existing = clipBriefs.find(c => c.slot === parseInt(slot));
      if (existing) {
        existing.clipUrl = clipUrl || existing.clipUrl;
        existing.source = "manual_upload";
        existing.approved = true;
      } else {
        clipBriefs.push({ slot: parseInt(slot), clipUrl: clipUrl || "", source: "manual_upload", approved: true });
      }
      script.clipBriefs = clipBriefs;
      await saveScript(rowId, script);

      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({
    error: "action required",
    available: ["batches", "scripts", "script-detail", "player-photo", "replace-clip"],
  });
};

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}
