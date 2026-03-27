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
  NBA: {
    key: "basketball_nba",
    markets: "player_points,player_rebounds,player_assists,player_threes",
  },
  MLB: {
    key: "baseball_mlb",
    markets: "batter_hits,batter_home_runs,pitcher_strikeouts,batter_total_bases",
  },
  NHL: {
    key: "icehockey_nhl",
    markets: "player_points,player_assists,player_goals,player_shots_on_goal",
  },
  NFL: {
    key: "americanfootball_nfl",
    markets: "player_pass_yds,player_rush_yds,player_reception_yds,player_receptions",
  },
};

// Friendly stat label from Odds API market key
const MARKET_LABEL = {
  // NBA
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3-Pointers Made",
  player_blocks: "Blocks",
  player_steals: "Steals",
  player_turnovers: "Turnovers",
  player_double_double: "Double Double",
  player_points_rebounds_assists: "Pts+Reb+Ast",
  player_points_rebounds: "Pts+Reb",
  player_points_assists: "Pts+Ast",
  // MLB batters
  batter_hits: "Hits",
  batter_home_runs: "Home Runs",
  batter_rbis: "RBIs",
  batter_total_bases: "Total Bases",
  batter_walks: "Walks",
  // MLB pitchers
  pitcher_strikeouts: "Strikeouts",
  pitcher_hits_allowed: "Hits Allowed",
  pitcher_earned_runs: "Earned Runs",
  pitcher_walks: "Walks Allowed",
  // NHL
  player_goals: "Goals",
  player_assists: "Assists",
  player_points: "Points",
  player_shots_on_goal: "Shots on Goal",
  goalie_saves: "Saves",
  player_blocked_shots: "Blocked Shots",
  // NFL
  player_pass_yds: "Pass Yards",
  player_pass_tds: "Pass TDs",
  player_rush_yds: "Rush Yards",
  player_reception_yds: "Receiving Yards",
  player_receptions: "Receptions",
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
  // Get upcoming events (no date filter — Odds API returns upcoming by default)
  // Then filter to today + tomorrow in PT to catch evening games
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/events?apiKey=${apiKey}&dateFormat=iso`;
  const events = await fetchWithTimeout(url);
  if (!Array.isArray(events)) return [];

  // Filter to events starting within next 24 hours
  const now = Date.now();
  const cutoff = now + 24 * 60 * 60 * 1000;
  return events.filter(e => {
    const t = new Date(e.commence_time).getTime();
    return t >= now - 6 * 60 * 60 * 1000 && t <= cutoff; // include games started up to 6h ago (live)
  });
}

/**
 * Fetch player prop odds for a single event from The Odds API.
 * Returns normalized array of { player, stat, market, books: {bookName: line} }
 */
async function getEventPlayerProps(sportKey, eventId, markets, apiKey) {
  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${markets}&oddsFormat=american`;
  console.log(`[lines] Fetching props: ${sportKey} event ${eventId}, markets: ${markets}`);
  const data = await fetchWithTimeout(url);
  console.log(`[lines] Event ${eventId}: ${data.bookmakers?.length || 0} bookmakers returned`);
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

    const cat = statCategory(p.market);
    return {
      ...p,
      discrepancy,
      bestOver: { book: bestOver[0], line: bestOver[1] },
      bestUnder: { book: bestUnder[0], line: bestUnder[1] },
      lineShopAlert: discrepancy >= 1.0,
      category: cat,
    };
  });
}

function statCategory(market) {
  if (!market) return "other";
  const combo = ["player_points_rebounds_assists","player_points_rebounds","player_points_assists"];
  const primary = ["player_points","player_goals","pitcher_strikeouts","player_pass_yds","player_pass_tds"];
  const pitching = ["pitcher_strikeouts","pitcher_hits_allowed","pitcher_earned_runs","pitcher_walks"];
  if (combo.includes(market)) return "combo";
  if (pitching.includes(market)) return "pitching";
  if (primary.includes(market)) return "primary";
  return "secondary";
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Serve from cache — bust if manual OR if cached result has 0 props
  try {
    const cached = await kv.get("lines:combined");
    if (cached) {
      const isEmpty = !cached.propCount || cached.propCount === 0;
      const isBust = req.query?.bust === "1";
      if (!isEmpty && !isBust) return res.status(200).json(cached);
      // If empty cache + manual bust, fall through to fresh fetch
    }
  } catch (_) {}

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

  try { await kv.set("lines:combined", payload, 7200); } catch (_) {} // 2 hour cache

  return res.status(200).json(payload);
};
