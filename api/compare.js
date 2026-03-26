/**
 * api/compare.js  →  GET /api/compare?player=NAME&stat=STAT
 *
 * Looks up a player+stat combination across all cached book lines.
 * Returns the line at each available book, best Over, best Under.
 *
 * Uses the lines:combined cache — no live API calls.
 */

const kv = require("./_kv");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { player, stat } = req.query;
  if (!player) return res.status(400).json({ error: "player query param required" });

  const cached = await kv.get("lines:combined");
  if (!cached) {
    return res.status(200).json({ found: false, message: "No lines cached. Fetch /api/lines first." });
  }

  const playerLower = (player || "").toLowerCase().trim();
  const statLower   = (stat  || "").toLowerCase().trim();

  // Exact match first, then partial name match
  const matches = (cached.props || []).filter(p => {
    const nameLower = p.player.toLowerCase();
    const nameMatch = nameLower === playerLower
      || nameLower.includes(playerLower)
      || playerLower.includes(nameLower.split(" ").pop()); // last name match
    if (!nameMatch) return false;
    if (statLower) {
      return p.stat.toLowerCase().includes(statLower) || p.market?.toLowerCase().includes(statLower);
    }
    return true;
  });

  if (!matches.length) {
    return res.status(200).json({
      found: false,
      player,
      stat: stat || null,
      message: `No lines found for "${player}"${stat ? ` / ${stat}` : ""}`,
      availableBooks: cached.hasOddsApi ? ["draftkings","fanduel","betmgm","pointsbet"] : [],
    });
  }

  return res.status(200).json({
    found: true,
    player,
    results: matches.map(m => ({
      player: m.player,
      stat: m.stat,
      books: m.books,
      bestOver: m.bestOver,
      bestUnder: m.bestUnder,
      discrepancy: m.discrepancy,
      lineShopAlert: m.lineShopAlert,
    })),
  });
};
