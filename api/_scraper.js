/**
 * api/_scraper.js
 * Hits the PrizePicks internal API to get live prop lines.
 * Prefixed with _ so Vercel does NOT expose it as a route.
 */

const axios = require("axios");

const BASE = "https://api.prizepicks.com";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Origin": "https://app.prizepicks.com",
  "Referer": "https://app.prizepicks.com/",
  "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "Connection": "keep-alive",
};

function buildIncludedMap(included = []) {
  const map = {};
  for (const item of included) {
    if (!map[item.type]) map[item.type] = {};
    map[item.type][item.id] = item;
  }
  return map;
}

function normalizeProjection(proj, includedMap) {
  const attrs = proj.attributes || {};
  const playerRel = proj.relationships?.new_player?.data;
  const playerData = playerRel ? includedMap["new_player"]?.[playerRel.id] : null;
  const playerAttrs = playerData?.attributes || {};
  const leagueRel = proj.relationships?.league?.data;
  const leagueData = leagueRel ? includedMap["league"]?.[leagueRel.id] : null;
  const leagueAttrs = leagueData?.attributes || {};

  return {
    id: proj.id,
    player: playerAttrs.display_name || playerAttrs.name || "Unknown Player",
    team: playerAttrs.team || playerAttrs.team_name || "",
    position: playerAttrs.position || "",
    image_url: playerAttrs.image_url || "",
    sport: leagueAttrs.sport || leagueAttrs.name || attrs.sport || "",
    league: leagueAttrs.name || leagueAttrs.abbreviation || "",
    stat: attrs.stat_type || attrs.projection_type || "",
    line: parseFloat(attrs.line_score) || 0,
    description: attrs.description || "",
    status: attrs.status || "pre_game",
    start_time: attrs.start_time || null,
  };
}

async function scrapeAll() {
  console.log("[scraper] Fetching PrizePicks projections...");

  const res = await axios.get(`${BASE}/projections`, {
    headers: HEADERS,
    params: {
      include: "new_player,league,stat_type",
      per_page: 250,
      single_stat: true,
    },
    timeout: 20000,
  });

  const raw = res.data || {};
  const included = raw.included || [];
  const includedMap = buildIncludedMap(included);

  const projections = (raw.data || [])
    .map((p) => normalizeProjection(p, includedMap))
    .filter((p) => p.line > 0 && p.player !== "Unknown Player");

  const grouped = {};
  for (const p of projections) {
    const key = p.sport || p.league || "Other";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(p);
  }

  const leaguesSeen = Object.keys(grouped);
  console.log(`[scraper] ${projections.length} props across: ${leaguesSeen.join(", ")}`);

  return { projections, grouped, leaguesSeen, total: projections.length, scrapedAt: new Date().toISOString() };
}

module.exports = { scrapeAll };
