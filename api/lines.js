/**
 * api/lines.js  →  GET /api/lines
 *
 * Fetches player prop lines from real, available sources:
 *
 * 1. THE ODDS API (free tier, 500 req/month, needs ODDS_API_KEY env var)
 *    - Gives player prop lines from DraftKings, FanDuel, BetMGM, PointsBet, etc.
 *    - Docs: https://the-odds-api.com/liveapi/guides/v4/#get-odds-sport-events-eventid-odds
 *    - Flow: get today's event IDs → fetch player props per event
 *    - Only fetches events for sports where we have active picks (quota-efficient)
 *
 * 2. SLEEPER TRENDING (free, no key needed)
 *    - NOT prop lines — gives most-added DFS players = lineup signal
 *    - Useful for flagging concentrated DFS exposure
 *
 * NOTE: Underdog Fantasy has no public API. Their app endpoints are private.
 * The refresh.js prompt already instructs the AI to search for Underdog lines
 * during its web research phase.
 *
 * Cache: 30 minutes in KV (lines:combined)
 */

const kv = require("./_kv");

// The Odds API sport keys
const ODDS_SPORT_MAP = {
  NBA: { key: "basketball_nba", markets: "player_points,player_rebounds,player_assists,player_threes,player_blocks,player_steals,player_points_rebounds_assists" },
  MLB: { key: "baseball_mlb",   markets: "batter_hits,pitcher_strikeouts,batter_home_runs,batter_rbis,batter_total_bases" },
  NHL: { key: "icehockey_nhl",  markets: "player_goals,player_assists,player_shots_on_goal,player_blocked_shots" },
  NFL: { key: "americanfootball_nfl", markets: "player_pass_yds,player_rush_yds,player_reception_yds,player_receptions,player_pass_tds,player_rush_attempts" },
};

// Friendly stat label from Odds API market key
const MARKET_LABEL = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3-Pointers Made",
  player_blocks: "Blocks",
  player_steals: "Steals",
  player_points_rebounds_assists: "Pts+Reb+Ast",
  batter_hits: "Hits",
  pitcher_strikeouts: "Strikeouts",
  batter_home_runs: "Home Runs",
  batter_rbis: "RBIs",
  batter_total_bases: "Total Bases",
  player_goals: "Goals",
  player_assists_hockey: "Assists",
  player_shots_on_goal: "Shots on Goal",
  player_blocked_shots: "Blocked Shots",
  player_pass_yds: "Pass Yards",
  player_rush_yds: "Rush Yards",
  player_reception_yds: "Receiving Yards",
  player_receptions: "Receptions",
  player_pass_tds: "Pass TDs",
  player_rush_attempts: "Rush Attempts",
};

async function fetchWithTimeout(url, ms = 9000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status}: ${body.slice(0, 120)}`);
  }
  return r.json();
}

/**
 * Get today's event IDs from The Odds API for a given sport.
 * Returns [{id, home_team, away_team, commence_time}, ...]
 */
async function getTodayEvents(sportKey, apiKey) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const toISO = d => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const from = toISO(new Date(`${today}T00:00:00-07:00`));
  const to   = toISO(new Date(`${today}T23:59:59-07:00`));
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/events?apiKey=${apiKey}&dateFormat=iso&commenceTimeFrom=${from}&commenceTimeTo=${to}`;
  const events = await fetchWithTimeout(url);
  return Array.isArray(events) ? events : [];
}

/**
 * Fetch player prop odds for a single event from The Odds API.
 * Returns normalized array of { player, stat, market, books: {bookName: line} }
 */
async function getEventPlayerProps(sportKey, eventId, markets, apiKey) {
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${markets}&oddsFormat=american`;
  const data = await fetchWithTimeout(url);
  if (!data.bookmakers) return [];

  // Normalize: player → stat → book → line
  const playerProps = {};

  for (const bookie of data.bookmakers) {
    const bookName = bookie.key; // e.g. "draftkings", "fanduel"
    for (const market of (bookie.markets || [])) {
      const statLabel = MARKET_LABEL[market.key] || market.key;
      for (const outcome of (market.outcomes || [])) {
        if (outcome.name !== "Over" && outcome.name !== "Under") continue;
        const player = outcome.description; // player full name
        if (!player || outcome.point == null) continue;

        const pKey = `${player}|${statLabel}`;
        if (!playerProps[pKey]) {
          playerProps[pKey] = { player, stat: statLabel, market: market.key, books: {} };
        }
        // Only store Over lines (the line value is the same for Over/Under)
        if (outcome.name === "Over") {
          playerProps[pKey].books[bookName] = outcome.point;
        }
      }
    }
  }

  return Object.values(playerProps);
}

/**
 * Fetch The Odds API player props for all sports where we have active picks.
 * Returns flat array of normalized prop objects.
 */
async function fetchOddsApiProps(apiKey) {
  // Read current picks to know which sports are active (saves quota)
  let activeSports = Object.keys(ODDS_SPORT_MAP); // fallback: all
  try {
    const picks = await kv.get("picks:latest");
    if (picks?.picks?.length) {
      const sportSet = new Set(picks.picks.map(p => p.sport?.toUpperCase()).filter(Boolean));
      const mapped = Object.keys(ODDS_SPORT_MAP).filter(s => sportSet.has(s));
      if (mapped.length) activeSports = mapped;
    }
  } catch (_) {}

  const allProps = [];
  const errors = [];

  for (const sport of activeSports) {
    const { key, markets } = ODDS_SPORT_MAP[sport];
    try {
      const events = await getTodayEvents(key, apiKey);
      console.log(`[lines] ${sport}: ${events.length} events today`);

      // Fetch player props per event in parallel (up to 6 events to limit quota)
      const eventBatch = events.slice(0, 6);
      const results = await Promise.allSettled(
        eventBatch.map(e => getEventPlayerProps(key, e.id, markets, apiKey))
      );
      for (const r of results) {
        if (r.status === "fulfilled") allProps.push(...r.value);
        else errors.push(`${sport} event: ${r.reason?.message}`);
      }
    } catch (e) {
      errors.push(`${sport}: ${e.message}`);
    }
  }

  return { props: allProps, errors };
}

/**
 * Fetch Sleeper trending players (most-added in last 24h).
 * This is lineup-concentration signal, NOT prop lines.
 */
async function fetchSleeperTrending() {
  const sports = ["nfl", "nba", "mlb"];
  const results = await Promise.allSettled(
    sports.map(async sport => {
      const url = `https://api.sleeper.app/v1/players/${sport}/trending/add?look_back_hours=24&limit=20`;
      const data = await fetchWithTimeout(url, 6000);
      return (Array.isArray(data) ? data : []).map(item => ({
        sport: sport.toUpperCase(),
        player_id: item.player_id,
        adds: item.count,
      }));
    })
  );
  const trending = [];
  for (const r of results) {
    if (r.status === "fulfilled") trending.push(...r.value);
  }
  return trending;
}

/**
 * Given an array of prop objects, compute best Over/Under book and max discrepancy.
 */
function enrichProps(props) {
  return props.map(p => {
    const lines = Object.entries(p.books);
    if (lines.length === 0) return p;

    const values = lines.map(([, v]) => v);
    const minLine = Math.min(...values);
    const maxLine = Math.max(...values);
    const discrepancy = parseFloat((maxLine - minLine).toFixed(1));

    // Best OVER = lowest line (easier to clear)
    const bestOver = lines.reduce((a, b) => a[1] <= b[1] ? a : b);
    // Best UNDER = highest line (more room above)
    const bestUnder = lines.reduce((a, b) => a[1] >= b[1] ? a : b);

    return {
      ...p,
      discrepancy,
      bestOver: { book: bestOver[0], line: bestOver[1] },
      bestUnder: { book: bestUnder[0], line: bestUnder[1] },
      lineShopAlert: discrepancy >= 1.0,
    };
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Serve from cache (skip with ?bust=1)
  if (req.query?.bust !== "1") {
    try {
      const cached = await kv.get("lines:combined");
      if (cached) return res.status(200).json(cached);
    } catch (_) {}
  }

  const apiKey = process.env.ODDS_API_KEY;
  const [oddsResult, sleeperResult] = await Promise.allSettled([
    apiKey ? fetchOddsApiProps(apiKey) : Promise.resolve({ props: [], errors: ["ODDS_API_KEY not set"] }),
    fetchSleeperTrending(),
  ]);

  const rawProps = oddsResult.status === "fulfilled" ? oddsResult.value.props : [];
  const oddsErrors = oddsResult.status === "fulfilled" ? oddsResult.value.errors : [oddsResult.reason?.message];
  const sleeperTrending = sleeperResult.status === "fulfilled" ? sleeperResult.value : [];
  const enriched = enrichProps(rawProps);

  // Build player-keyed lookup for quick access
  const byPlayer = {};
  for (const p of enriched) {
    const k = `${p.player.toLowerCase()}|${p.stat.toLowerCase()}`;
    byPlayer[k] = p;
  }

  const payload = {
    props: enriched,
    byPlayer,
    sleeperTrending,
    hasOddsApi: !!apiKey,
    propCount: enriched.length,
    lineShopCount: enriched.filter(p => p.lineShopAlert).length,
    fetchedAt: new Date().toISOString(),
    errors: [...(oddsErrors || [])].filter(Boolean),
  };

  try { await kv.set("lines:combined", payload, 1800); } catch (_) {}

  return res.status(200).json(payload);
};
