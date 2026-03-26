/**
 * api/refresh.js  →  POST /api/refresh
 * Manually triggers a full scrape + AI analysis.
 * Protected by CRON_SECRET to prevent abuse.
 *
 * Usage: POST /api/refresh
 * Headers: { "x-secret": "your-cron-secret" }
 *   OR query: /api/refresh?secret=your-cron-secret
 */

const { scrapeAll }    = require("./_scraper");
const { analyzePicks } = require("./_analyzer");
const kv               = require("./_kv");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-secret, content-type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth check
  const secret = req.headers["x-secret"] || req.query?.secret;
  const expected = process.env.CRON_SECRET;
  if (expected && secret !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Set a "refreshing" flag so the frontend can show a spinner
  await kv.set("picks:refreshing", { refreshing: true, startedAt: new Date().toISOString() }, 300);

  // Run async — respond immediately, client will poll /api/picks
  runRefresh().catch(console.error);

  return res.status(202).json({
    message: "Refresh started. Poll /api/picks in ~60 seconds for results.",
    startedAt: new Date().toISOString(),
  });
};

async function runRefresh() {
  try {
    console.log("[refresh] Starting scrape...");
    const scraped = await scrapeAll();

    if (!scraped.projections.length) {
      throw new Error("No props returned from PrizePicks — market may be closed.");
    }

    console.log("[refresh] Starting AI analysis...");
    const picks = await analyzePicks(scraped.projections, scraped.leaguesSeen);

    await kv.set("picks:latest", {
      picks,
      scrapedAt:   scraped.scrapedAt,
      analyzedAt:  new Date().toISOString(),
      leaguesSeen: scraped.leaguesSeen,
      totalProps:  scraped.total,
    }, 86400 * 2); // cache for 2 days

    // Clear refreshing flag
    await kv.set("picks:refreshing", { refreshing: false }, 60);

    console.log(`[refresh] ✅ Done. ${picks.length} picks stored.`);
  } catch (err) {
    console.error("[refresh] ❌ Failed:", err.message);
    await kv.set("picks:refreshing", { refreshing: false, error: err.message }, 120);
  }
}
