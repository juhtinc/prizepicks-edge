/**
 * api/scores.js  →  GET /api/scores
 * Fetches today's scores from ESPN's free public API for 6 leagues.
 * Caches in KV for 2 minutes — no Anthropic API calls, no API key needed.
 */

const kv = require("./_kv");

const LEAGUES = [
  { sport: "NBA", url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard" },
  { sport: "MLB", url: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard" },
  { sport: "NHL", url: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard" },
  { sport: "NFL", url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard" },
  { sport: "MLS", url: "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard" },
  { sport: "Tennis", url: "https://site.api.espn.com/apis/site/v2/sports/tennis/scoreboard" },
];

function parseEvent(event, sport) {
  const comp = event.competitions?.[0];
  if (!comp) return null;

  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === "home") || competitors[0];
  const away = competitors.find(c => c.homeAway === "away") || competitors[1];
  if (!home || !away) return null;

  const statusName = event.status?.type?.name || "";
  const statusDetail = event.status?.type?.shortDetail || "";

  let status = "pregame";
  if (["STATUS_FINAL", "STATUS_FULL_TIME", "STATUS_END_PERIOD"].includes(statusName)) status = "final";
  else if (["STATUS_IN_PROGRESS", "STATUS_HALFTIME", "STATUS_END_OF_PERIOD"].includes(statusName)) status = "live";

  const rawDate = comp.date || event.date;
  const startTime = rawDate
    ? new Date(rawDate).toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles",
      }) + " PT"
    : "";

  return {
    id: event.id,
    sport,
    name: event.shortName || event.name || "",
    home: {
      team: home.team?.abbreviation || home.team?.name || "?",
      name: home.team?.displayName || home.team?.name || "",
      score: home.score != null ? String(home.score) : null,
      winner: home.winner || false,
    },
    away: {
      team: away.team?.abbreviation || away.team?.name || "?",
      name: away.team?.displayName || away.team?.name || "",
      score: away.score != null ? String(away.score) : null,
      winner: away.winner || false,
    },
    status,
    statusDetail,
    startTime,
    venue: comp.venue?.fullName || "",
    period: event.status?.period || null,
  };
}

// ── ESPN sport key map for player search ──
const ESPN_SPORT_SLUG = {
  NBA: "basketball/nba", MLB: "baseball/mlb", NHL: "hockey/nhl", NFL: "football/nfl",
};

// ── Player Game Logs: GET /api/scores?mode=gamelogs&player=NAME&sport=NBA ──
async function handleGameLogs(req, res) {
  const { player, sport } = req.query;
  if (!player) return res.status(400).json({ error: "player param required" });

  const sportSlug = ESPN_SPORT_SLUG[(sport || "NBA").toUpperCase()] || "basketball/nba";
  const cacheKey = `gamelogs:${player.toLowerCase().replace(/\s+/g,'-')}:${sport||'NBA'}`;

  // Cache 1 hour
  try {
    const cached = await kv.get(cacheKey);
    if (cached) return res.status(200).json(cached);
  } catch (_) {}

  try {
    // Step 1: Search for the player on ESPN
    const searchUrl = `https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(player)}&limit=5&type=player`;
    const searchR = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PropsEdge/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!searchR.ok) throw new Error("ESPN search failed: " + searchR.status);
    const searchData = await searchR.json();

    // Find best player match
    const results = searchData.results || searchData.items || [];
    const athletes = (results.find(r => r.type === "athlete") || results[0])?.contents || results;
    if (!athletes.length) return res.status(200).json({ found: false, player, games: [] });

    const match = athletes[0];
    const athleteId = match.uid?.split(":").pop() || match.id;
    const athleteName = match.title || match.displayName || match.name || player;

    if (!athleteId) return res.status(200).json({ found: false, player, games: [] });

    // Step 2: Fetch game log from ESPN
    const logUrl = `https://site.web.api.espn.com/apis/common/v3/sports/${sportSlug}/athletes/${athleteId}/gamelog`;
    const logR = await fetch(logUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PropsEdge/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!logR.ok) throw new Error("ESPN gamelog failed: " + logR.status);
    const logData = await logR.json();

    // Parse game log — ESPN returns categories with labels + events with stats
    const categories = logData.categories || [];
    const seasonType = logData.seasonTypes || logData.events || [];
    const games = [];

    // Try parsing the standard format
    const labels = logData.labels || [];
    const events = logData.events || {};
    const entries = logData.entries || [];

    // Format: entries[] has stats array matching labels[]
    if (entries.length && labels.length) {
      for (const entry of entries.slice(-15)) { // last 15 games
        const stats = {};
        labels.forEach((label, i) => { stats[label] = entry.stats?.[i] ?? null; });
        games.push({
          date: entry.date || null,
          opponent: entry.opponent?.abbreviation || entry.opponent?.displayName || null,
          home: entry.home ?? null,
          result: entry.result || null,
          stats,
        });
      }
    }

    // Alternative format: seasonTypes[].categories[].events[]
    if (!games.length && Array.isArray(seasonType)) {
      for (const st of seasonType) {
        for (const cat of (st.categories || [])) {
          const catLabels = cat.labels || [];
          for (const ev of (cat.events || []).slice(-15)) {
            const stats = {};
            catLabels.forEach((label, i) => { stats[label] = ev.stats?.[i] ?? null; });
            games.push({
              date: ev.eventDate || null,
              opponent: ev.opponent?.abbreviation || null,
              home: ev.home ?? null,
              result: ev.gameResult || null,
              stats,
            });
          }
        }
      }
    }

    const payload = {
      found: true,
      player: athleteName,
      athleteId,
      sport: sport || "NBA",
      gamesPlayed: games.length,
      games: games.reverse(), // most recent first
      fetchedAt: new Date().toISOString(),
    };

    try { await kv.set(cacheKey, payload, 3600); } catch (_) {} // 1hr cache
    return res.status(200).json(payload);
  } catch (err) {
    console.error("[gamelogs] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Route: game logs mode
  if (req.query?.mode === "gamelogs") return handleGameLogs(req, res);

  // Serve from cache if fresh (2-minute TTL)
  try {
    const cached = await kv.get("scores:latest");
    if (cached) return res.status(200).json(cached);
  } catch (_) {}

  // Fetch all leagues in parallel; don't let one failure block the rest
  const results = await Promise.allSettled(
    LEAGUES.map(async ({ sport, url }) => {
      const r = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PrizePicksEdge/1.0)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`${sport} HTTP ${r.status}`);
      const d = await r.json();
      return (d.events || []).map(e => parseEvent(e, sport)).filter(Boolean);
    })
  );

  const games = [];
  const errors = [];
  for (const r of results) {
    if (r.status === "fulfilled") games.push(...r.value);
    else errors.push(r.reason?.message || "unknown");
  }

  const payload = {
    games,
    fetchedAt: new Date().toISOString(),
    ...(errors.length && { errors }),
  };

  // Cache 2 minutes
  try { await kv.set("scores:latest", payload, 120); } catch (_) {}

  return res.status(200).json(payload);
};
