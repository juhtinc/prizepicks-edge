/**
 * api/lore/post-schedule.js  →  POST /api/lore/post-schedule
 * Feature #9: Calculate and set optimal post times for batch scripts.
 *
 * Body: { batchId }
 * Auth: x-secret header
 */

const { getOptimalPostTime } = require("./lib/post-times");
const { getBatchScripts, saveScript } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { batchId } = req.body || {};
  if (!batchId) return res.status(400).json({ error: "batchId required" });

  const scripts = await getBatchScripts(batchId);
  if (!scripts.length) return res.status(404).json({ error: "No scripts found" });

  const results = await Promise.all(scripts.map(async (script) => {
    const postTime = getOptimalPostTime(script.playerSport);
    script.scheduledPostTime = postTime;
    await saveScript(script.rowId, script);
    return { rowId: script.rowId, sport: script.playerSport, postTime };
  }));

  return res.status(200).json({ ok: true, batchId, schedules: results });
};
