/**
 * api/boxscore.js  →  GET /api/boxscore?gameId=XXX&sport=NBA
 * Fetches detailed box score from ESPN's free summary endpoint.
 * Cache: 30s for live games, 24h for final games.
 * Zero Anthropic API calls — purely free ESPN data.
 */

const kv = require("./_kv");

const SPORT_URL = {
  NBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary",
  MLB: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary",
  NHL: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary",
  NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary",
  MLS: "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/summary",
};

async function fetchESPN(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PropsEdge/1.0)" },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`ESPN HTTP ${r.status}`);
  return r.json();
}

// ── Sport-specific parsers ──────────────────────────────────────────────────

function parseNBA(data) {
  const boxscore = data.boxscore || {};
  const teams = boxscore.teams || [];
  const players = boxscore.players || [];

  // Quarter scores from line score
  const lineScore = (teams || []).map(t => ({
    team: t.team?.abbreviation || "?",
    teamName: t.team?.displayName || "",
    logo: t.team?.logo || "",
    color: t.team?.color ? `#${t.team.color}` : null,
    periods: (t.statistics || []).length > 0 ? [] : [],
  }));

  // Player stats
  const playerStats = players.map(teamPlayers => {
    const team = teamPlayers.team?.abbreviation || "?";
    const stats = [];
    for (const group of (teamPlayers.statistics || [])) {
      const labels = group.labels || [];
      for (const athlete of (group.athletes || [])) {
        if (!athlete.athlete?.displayName) continue;
        const row = { player: athlete.athlete.displayName, team, starter: athlete.starter || false };
        const vals = athlete.stats || [];
        labels.forEach((label, i) => { row[label] = vals[i] || "0"; });
        stats.push(row);
      }
    }
    return { team, stats };
  });

  // Team stats comparison
  const teamStats = (boxscore.teams || []).map(t => {
    const obj = { team: t.team?.abbreviation || "?" };
    for (const s of (t.statistics || [])) {
      obj[s.label || s.name] = s.displayValue || s.value;
    }
    return obj;
  });

  // Line score (quarter by quarter)
  const header = data.header || {};
  const competitions = header.competitions || [];
  const comp = competitions[0] || {};
  const competitors = comp.competitors || [];
  const periodScores = competitors.map(c => ({
    team: c.team?.abbreviation || "?",
    homeAway: c.homeAway,
    periods: (c.linescores || []).map(ls => ls.displayValue || ls.value || "0"),
    total: c.score || "0",
  }));

  return { playerStats, teamStats, periodScores, type: "NBA" };
}

function parseMLB(data) {
  const boxscore = data.boxscore || {};
  const players = boxscore.players || [];

  // Line score (inning by inning)
  const header = data.header || {};
  const comp = (header.competitions || [])[0] || {};
  const competitors = comp.competitors || [];
  const lineScore = competitors.map(c => ({
    team: c.team?.abbreviation || "?",
    homeAway: c.homeAway,
    innings: (c.linescores || []).map(ls => ls.displayValue || ls.value || "0"),
    runs: c.score || "0",
    hits: c.hits || "0",
    errors: c.errors || "0",
  }));

  // Player stats (batters + pitchers)
  const playerStats = players.map(teamPlayers => {
    const team = teamPlayers.team?.abbreviation || "?";
    const groups = {};
    for (const group of (teamPlayers.statistics || [])) {
      const type = group.type || group.name || "unknown";
      const labels = group.labels || [];
      const athletes = [];
      for (const athlete of (group.athletes || [])) {
        if (!athlete.athlete?.displayName) continue;
        const row = { player: athlete.athlete.displayName, team, starter: athlete.starter || false };
        const vals = athlete.stats || [];
        labels.forEach((label, i) => { row[label] = vals[i] || "0"; });
        athletes.push(row);
      }
      groups[type] = { labels, athletes };
    }
    return { team, groups };
  });

  // Game situation
  const situation = data.situation || {};
  const gameInfo = {
    balls: situation.balls ?? null,
    strikes: situation.strikes ?? null,
    outs: situation.outs ?? null,
    onFirst: situation.onFirst || false,
    onSecond: situation.onSecond || false,
    onThird: situation.onThird || false,
    batter: situation.batter?.athlete?.displayName || null,
    pitcher: situation.pitcher?.athlete?.displayName || null,
  };

  return { lineScore, playerStats, gameInfo, type: "MLB" };
}

function parseNHL(data) {
  const boxscore = data.boxscore || {};
  const players = boxscore.players || [];

  // Period scores
  const header = data.header || {};
  const comp = (header.competitions || [])[0] || {};
  const competitors = comp.competitors || [];
  const periodScores = competitors.map(c => ({
    team: c.team?.abbreviation || "?",
    homeAway: c.homeAway,
    periods: (c.linescores || []).map(ls => ls.displayValue || ls.value || "0"),
    total: c.score || "0",
  }));

  // Player stats (skaters + goalies)
  const playerStats = players.map(teamPlayers => {
    const team = teamPlayers.team?.abbreviation || "?";
    const groups = {};
    for (const group of (teamPlayers.statistics || [])) {
      const type = group.type || group.name || "unknown";
      const labels = group.labels || [];
      const athletes = [];
      for (const athlete of (group.athletes || [])) {
        if (!athlete.athlete?.displayName) continue;
        const row = { player: athlete.athlete.displayName, team, starter: athlete.starter || false };
        const vals = athlete.stats || [];
        labels.forEach((label, i) => { row[label] = vals[i] || "0"; });
        athletes.push(row);
      }
      groups[type] = { labels, athletes };
    }
    return { team, groups };
  });

  return { periodScores, playerStats, type: "NHL" };
}

function parseGeneric(data) {
  const header = data.header || {};
  const comp = (header.competitions || [])[0] || {};
  const competitors = comp.competitors || [];
  const periodScores = competitors.map(c => ({
    team: c.team?.abbreviation || "?",
    homeAway: c.homeAway,
    periods: (c.linescores || []).map(ls => ls.displayValue || ls.value || "0"),
    total: c.score || "0",
  }));
  return { periodScores, type: "generic" };
}

// ── Shared fields ───────────────────────────────────────────────────────────

function parseCommon(data, sport) {
  const header = data.header || {};
  const comp = (header.competitions || [])[0] || {};
  const competitors = comp.competitors || [];
  const gameStatus = header.gameNote || comp.statusDetail || data.header?.season?.type || "";

  const teams = competitors.map(c => ({
    abbr: c.team?.abbreviation || "?",
    name: c.team?.displayName || "",
    logo: c.team?.logos?.[0]?.href || c.team?.logo || "",
    color: c.team?.color ? `#${c.team.color}` : "#333",
    score: c.score || "0",
    homeAway: c.homeAway,
    record: c.record?.[0]?.displayValue || "",
    winner: c.winner || false,
  }));

  const statusType = header.competitions?.[0]?.status?.type?.name || "";
  let status = "pregame";
  if (["STATUS_FINAL", "STATUS_FULL_TIME"].includes(statusType)) status = "final";
  else if (["STATUS_IN_PROGRESS", "STATUS_HALFTIME", "STATUS_END_OF_PERIOD"].includes(statusType)) status = "live";

  // Play by play (last 10)
  const plays = (data.plays || []).slice(-10).reverse().map(p => ({
    text: p.text || p.shortText || "",
    clock: p.clock?.displayValue || "",
    period: p.period?.number || null,
    team: p.team?.abbreviation || "",
  }));

  // Leaders
  const leaders = (data.leaders || []).map(cat => ({
    name: cat.name || cat.displayName || "",
    leaders: (cat.leaders || []).slice(0, 2).map(l => ({
      player: l.athlete?.displayName || "",
      team: l.team?.abbreviation || "",
      value: l.displayValue || l.value || "",
    })),
  }));

  // ESPN game link
  const espnLink = data.header?.links?.find(l => l.rel?.includes("gamecast"))?.href
    || `https://www.espn.com/${sport.toLowerCase()}/game/_/gameId/${comp.id || ""}`;

  return { teams, status, statusType: gameStatus, plays, leaders, espnLink, sport, gameId: comp.id };
}

// ── Handler ─────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { gameId, sport } = req.query || {};
  if (!gameId || !sport) {
    return res.status(400).json({ error: "gameId and sport query params required" });
  }

  const cacheKey = `boxscore:${sport}:${gameId}`;

  // Check cache
  try {
    const cached = await kv.get(cacheKey);
    if (cached) return res.status(200).json(cached);
  } catch (_) {}

  const baseUrl = SPORT_URL[sport.toUpperCase()];
  if (!baseUrl) {
    return res.status(400).json({ error: `Unsupported sport: ${sport}` });
  }

  try {
    const url = `${baseUrl}?event=${gameId}`;
    const data = await fetchESPN(url);

    const common = parseCommon(data, sport.toUpperCase());

    let sportData;
    switch (sport.toUpperCase()) {
      case "NBA": sportData = parseNBA(data); break;
      case "MLB": sportData = parseMLB(data); break;
      case "NHL": sportData = parseNHL(data); break;
      default:    sportData = parseGeneric(data); break;
    }

    const payload = {
      ...common,
      ...sportData,
      fetchedAt: new Date().toISOString(),
    };

    // Cache: 30s live, 24h final, 5min pregame
    const ttl = common.status === "live" ? 30
      : common.status === "final" ? 86400
      : 300;
    try { await kv.set(cacheKey, payload, ttl); } catch (_) {}

    return res.status(200).json(payload);
  } catch (err) {
    console.error("[boxscore] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
