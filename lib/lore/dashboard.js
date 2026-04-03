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

  return res.status(400).json({
    error: "action required",
    available: ["batches", "scripts", "script-detail"],
  });
};

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}
