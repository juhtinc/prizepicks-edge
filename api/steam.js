/**
 * api/steam.js  →  GET /api/steam
 *
 * Detects steam moves by comparing current Odds API player prop lines
 * to a snapshot stored in KV from the previous fetch (≤15 min ago).
 *
 * Steam Move  : line shifts 0.5+ points on 1–2 books
 * Sharp Steam : same-direction shift on 3+ books simultaneously
 *
 * KV keys used:
 *   steam:prev    — previous line snapshot (TTL 15 min)
 *   steam:alerts  — active alerts (TTL 2 hours)
 *
 * Zero Anthropic API calls — free Odds API comparison only.
 */

const kv = require("./_kv");

const ODDS_SPORTS = [
  { sport: "NBA", key: "basketball_nba", markets: "player_points,player_rebounds,player_assists,player_threes" },
  { sport: "MLB", key: "baseball_mlb",   markets: "batter_hits,pitcher_strikeouts,batter_home_runs" },
  { sport: "NHL", key: "icehockey_nhl",  markets: "player_goals,player_shots_on_goal" },
  { sport: "NFL", key: "americanfootball_nfl", markets: "player_pass_yds,player_rush_yds,player_reception_yds" },
];

const MARKET_LABEL = {
  player_points: "Points", player_rebounds: "Rebounds", player_assists: "Assists",
  player_threes: "3-Pointers Made", batter_hits: "Hits", pitcher_strikeouts: "Strikeouts",
  batter_home_runs: "Home Runs", player_goals: "Goals", player_shots_on_goal: "Shots on Goal",
  player_pass_yds: "Pass Yards", player_rush_yds: "Rush Yards", player_reception_yds: "Receiving Yards",
};

async function fetchCurrentLines(apiKey) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const toISO = d => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const from = toISO(new Date(`${today}T00:00:00-07:00`));
  const to   = toISO(new Date(`${today}T23:59:59-07:00`));

  const allLines = {}; // "PLAYER|STAT" → { player, stat, sport, books: {book: line} }

  for (const { sport, key, markets } of ODDS_SPORTS) {
    try {
      const evR = await fetch(
        `https://api.the-odds-api.com/v4/sports/${key}/events?apiKey=${apiKey}&dateFormat=iso&commenceTimeFrom=${from}&commenceTimeTo=${to}`,
        { signal: AbortSignal.timeout(9000) }
      );
      if (!evR.ok) continue;
      const events = await evR.json();
      const batch = (Array.isArray(events) ? events : []).slice(0, 4); // limit quota usage

      await Promise.allSettled(batch.map(async event => {
        try {
          const prR = await fetch(
            `https://api.the-odds-api.com/v4/sports/${key}/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${markets}&oddsFormat=american`,
            { signal: AbortSignal.timeout(9000) }
          );
          if (!prR.ok) return;
          const data = await prR.json();

          for (const bookie of (data.bookmakers || [])) {
            for (const market of (bookie.markets || [])) {
              const statLabel = MARKET_LABEL[market.key] || market.key;
              for (const outcome of (market.outcomes || [])) {
                if (outcome.name !== "Over" || !outcome.description || outcome.point == null) continue;
                const pk = `${outcome.description}|${statLabel}`;
                if (!allLines[pk]) allLines[pk] = { player: outcome.description, stat: statLabel, sport, books: {} };
                allLines[pk].books[bookie.key] = outcome.point;
              }
            }
          }
        } catch (_) {}
      }));
    } catch (_) {}
  }

  return allLines;
}

function detectMoves(currentLines, prevLines, prevFetchedAt) {
  const timeDiffMin = (Date.now() - new Date(prevFetchedAt).getTime()) / 60000;
  const alerts = [];

  for (const [pk, curr] of Object.entries(currentLines)) {
    const prev = prevLines[pk];
    if (!prev) continue;

    const movers = [];
    for (const [book, currLine] of Object.entries(curr.books)) {
      const prevLine = prev.books[book];
      if (prevLine == null) continue;
      const move = currLine - prevLine;
      if (Math.abs(move) >= 0.5) movers.push({ book, prevLine, currLine, move });
    }
    if (!movers.length) continue;

    const directions = movers.map(b => Math.sign(b.move));
    const allSameDir = directions.every(d => d === directions[0]);
    const direction  = movers[0].move > 0 ? "UP" : "DOWN";
    const maxMove    = Math.max(...movers.map(b => Math.abs(b.move)));

    alerts.push({
      id: `${pk}-${Date.now()}`,
      player: curr.player,
      stat:   curr.stat,
      sport:  curr.sport,
      direction,
      move: parseFloat(maxMove.toFixed(1)),
      books: movers,
      bookCount: movers.length,
      isSharp: allSameDir && movers.length >= 3,
      timeDiffMin: parseFloat(timeDiffMin.toFixed(1)),
      detectedAt: new Date().toISOString(),
      expiresAt:  new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    });
  }

  // Sharp steam first, then by book count
  return alerts.sort((a, b) => (b.isSharp ? 1 : 0) - (a.isSharp ? 1 : 0) || b.bookCount - a.bookCount);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ alerts: [], message: "ODDS_API_KEY not configured" });
  }

  // Return cached alerts if last fetch was under 2 min ago (avoid hammering Odds API)
  try {
    const [cachedAlerts, prevSnap] = await Promise.all([
      kv.get("steam:alerts"),
      kv.get("steam:prev"),
    ]);
    if (cachedAlerts && prevSnap) {
      const age = Date.now() - new Date(prevSnap.fetchedAt).getTime();
      if (age < 2 * 60 * 1000) {
        return res.status(200).json({
          alerts: cachedAlerts.alerts || [],
          fetchedAt: cachedAlerts.fetchedAt,
          cached: true,
        });
      }
    }
  } catch (_) {}

  try {
    // Get previous snapshot
    let prevSnap = null;
    try { prevSnap = await kv.get("steam:prev"); } catch (_) {}

    // Fetch current lines
    const currentLines = await fetchCurrentLines(apiKey);
    const now = new Date().toISOString();

    // Detect new steam moves
    let newAlerts = [];
    if (prevSnap?.lines && prevSnap?.fetchedAt) {
      newAlerts = detectMoves(currentLines, prevSnap.lines, prevSnap.fetchedAt);
    }

    // Store current snapshot for next comparison (TTL 15 min)
    try { await kv.set("steam:prev", { lines: currentLines, fetchedAt: now }, 900); } catch (_) {}

    // Merge with unexpired existing alerts
    let existingAlerts = [];
    try {
      const ex = await kv.get("steam:alerts");
      if (ex?.alerts) existingAlerts = ex.alerts.filter(a => new Date(a.expiresAt) > new Date());
    } catch (_) {}

    const existingKeys = new Set(existingAlerts.map(a => `${a.player}|${a.stat}`));
    for (const alert of newAlerts) {
      if (!existingKeys.has(`${alert.player}|${alert.stat}`)) existingAlerts.push(alert);
    }
    existingAlerts = existingAlerts.slice(0, 20);

    try { await kv.set("steam:alerts", { alerts: existingAlerts, fetchedAt: now }, 7200); } catch (_) {}

    return res.status(200).json({
      alerts: existingAlerts,
      newAlerts: newAlerts.length,
      fetchedAt: now,
    });

  } catch (err) {
    console.error("[steam] Error:", err.message);
    return res.status(500).json({ error: err.message, alerts: [] });
  }
};
