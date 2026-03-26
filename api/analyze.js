/**
 * api/analyze.js  â†’  POST /api/analyze
 * Runs AI analysis on previously scraped props.
 * Called by the frontend after /api/refresh completes.
 */

const { analyzePicks } = require("./_analyzer");
const kv = require("./_kv");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-secret, content-type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const secret = req.headers["x-secret"] || req.query?.secret;
  const expected = process.env.CRON_SECRET;
  if (expected && secret !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const raw = await kv.get("picks:raw");
    if (!raw) {
      return res.status(400).json({ error: "No scraped props found. Run /api/refresh first." });
    }

    console.log(`[analyze] Running AI on ${raw.projections.length} props...`);
    await kv.set("picks:refreshing", { refreshing: true, step: "ai", startedAt: new Date().toISOString() }, 300);

    const picks = await analyzePicks(raw.projections, raw.leaguesSeen);

    await kv.set("picks:latest", {
      picks,
      scrapedAt: raw.scrapedAt,
      analyzedAt: new Date().toISOString(),
      leaguesSeen: raw.leaguesSeen,
      totalProps: raw.totalProps,
    }, 86400 * 2);

    await kv.set("picks:refreshing", { refreshing: false }, 60);

    console.log(`[analyze] âœ… ${picks.length} picks saved.`);
    return res.status(200).json({ ok: true, picks: picks.length });
  } catch (err) {
    console.error("[analyze] Error:", err.message);
    await kv.set("picks:refreshing", { refreshing: false, error: err.message }, 120);
    return res.status(500).json({ error: err.message });
  }
};
