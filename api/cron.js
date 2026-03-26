/**
 * api/cron.js  →  GET /api/cron
 * Called automatically by Vercel's cron scheduler (see vercel.json).
 * Schedule: 9am PT (17:00 UTC), 1pm PT (21:00 UTC), 6pm PT (02:00 UTC+1)
 * Protected by Vercel's built-in CRON_SECRET header injection.
 */

const { scrapeAll }    = require("./_scraper");
const { analyzePicks } = require("./_analyzer");
const kv               = require("./_kv");

module.exports = async function handler(req, res) {
  // Vercel injects Authorization: Bearer $CRON_SECRET for cron jobs
  const authHeader = req.headers.authorization;
  const expected = process.env.CRON_SECRET;

  if (expected && authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  console.log("[cron] Triggered at", new Date().toISOString());

  try {
    await kv.set("picks:refreshing", { refreshing: true, startedAt: new Date().toISOString() }, 300);

    const scraped = await scrapeAll();

    if (!scraped.projections.length) {
      await kv.set("picks:refreshing", { refreshing: false, error: "No props found" }, 120);
      return res.status(200).json({ ok: true, message: "No props available — market closed?" });
    }

    const picks = await analyzePicks(scraped.projections, scraped.leaguesSeen);

    await kv.set("picks:latest", {
      picks,
      scrapedAt:   scraped.scrapedAt,
      analyzedAt:  new Date().toISOString(),
      leaguesSeen: scraped.leaguesSeen,
      totalProps:  scraped.total,
    }, 86400 * 2);

    await kv.set("picks:refreshing", { refreshing: false }, 60);

    console.log(`[cron] ✅ ${picks.length} picks stored.`);
    return res.status(200).json({ ok: true, picks: picks.length, leagues: scraped.leaguesSeen });
  } catch (err) {
    console.error("[cron] ❌", err.message);
    await kv.set("picks:refreshing", { refreshing: false, error: err.message }, 120);
    return res.status(500).json({ error: err.message });
  }
};
