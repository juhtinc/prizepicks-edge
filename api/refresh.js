/**
 * api/refresh.js  â†’  POST /api/refresh
 * On Vercel Hobby (10s limit): scrapes PrizePicks, stores raw props,
 * then the analyze endpoint does the AI work separately.
 */

const { scrapeAll } = require("./_scraper");
const kv = require("./_kv");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-secret, content-type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = req.headers["x-secret"] || req.query?.secret;
  const expected = process.env.CRON_SECRET;
  if (expected && secret !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    console.log("[refresh] Scraping PrizePicks...");
    const scraped = await scrapeAll();

    if (!scraped.projections.length) {
      return res.status(200).json({ error: "No props found â€” market may be closed." });
    }

    // Store raw props for the analyze step
    await kv.set("picks:raw", {
      projections: scraped.projections,
      leaguesSeen: scraped.leaguesSeen,
      scrapedAt: scraped.scrapedAt,
      totalProps: scraped.total,
    }, 3600);

    await kv.set("picks:refreshing", { refreshing: true, step: "analyze", startedAt: new Date().toISOString() }, 300);

    console.log(`[refresh] Scraped ${scraped.total} props. Ready for analysis.`);

    return res.status(200).json({
      message: "Scrape done. Now call /api/analyze to run AI analysis.",
      total: scraped.total,
      leagues: scraped.leaguesSeen,
    });
  } catch (err) {
    console.error("[refresh] Error:", err.message);
    await kv.set("picks:refreshing", { refreshing: false, error: err.message }, 120);
    return res.status(500).json({ error: err.message });
  }
};
