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

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

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
