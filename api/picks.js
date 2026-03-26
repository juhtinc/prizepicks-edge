/**
 * api/picks.js  →  GET /api/picks
 * Returns cached picks from KV. If none exist, returns empty with a flag
 * telling the frontend to prompt the user to trigger a refresh.
 */

const kv = require("./_kv");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const cached = await kv.get("picks:latest");

    if (!cached) {
      return res.status(200).json({
        picks: [],
        meta: {
          total: 0,
          analyzedAt: null,
          scrapedAt: null,
          leaguesSeen: [],
          totalProps: 0,
          empty: true,
        },
      });
    }

    // Optional filters
    const { sport, direction, minConf } = req.query;
    let picks = cached.picks || [];

    if (sport && sport !== "ALL") {
      picks = picks.filter((p) =>
        (p.sport || "").toLowerCase().includes(sport.toLowerCase())
      );
    }
    if (direction && direction !== "ALL") {
      picks = picks.filter((p) => p.direction === direction.toUpperCase());
    }
    if (minConf) {
      picks = picks.filter((p) => p.confidence >= parseInt(minConf));
    }

    return res.status(200).json({
      picks,
      meta: {
        total: picks.length,
        analyzedAt: cached.analyzedAt,
        scrapedAt: cached.scrapedAt,
        leaguesSeen: cached.leaguesSeen || [],
        totalProps: cached.totalProps || 0,
        empty: false,
      },
    });
  } catch (err) {
    console.error("[picks] Error:", err);
    return res.status(500).json({ error: err.message });
  }
};
