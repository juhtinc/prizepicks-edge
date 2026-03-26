/**
 * api/status.js  →  GET /api/status
 * Returns server health, last refresh times, refreshing flag.
 */

const kv = require("./_kv");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const [cached, refreshing] = await Promise.all([
    kv.get("picks:latest"),
    kv.get("picks:refreshing"),
  ]);

  return res.status(200).json({
    ok: true,
    refreshing: refreshing?.refreshing ?? false,
    refreshError: refreshing?.error ?? null,
    analyzedAt: cached?.analyzedAt ?? null,
    scrapedAt: cached?.scrapedAt ?? null,
    totalPicks: cached?.picks?.length ?? 0,
    totalProps: cached?.totalProps ?? 0,
    leaguesSeen: cached?.leaguesSeen ?? [],
  });
};
