/**
 * api/news.js  →  GET /api/news
 * Fetches sports news from ESPN's free public API — zero Anthropic cost.
 * Covers NBA, MLB, NHL, NFL injuries and headlines.
 * Cache: 15 minutes in KV.
 */

const kv = require("./_kv");

const ESPN_FEEDS = [
  { sport: "NBA", url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news" },
  { sport: "MLB", url: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news" },
  { sport: "NHL", url: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news" },
  { sport: "NFL", url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news" },
];

// ESPN injury endpoints
const ESPN_INJURIES = [
  { sport: "NBA", url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries" },
  { sport: "MLB", url: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries" },
  { sport: "NHL", url: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries" },
  { sport: "NFL", url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries" },
];

async function fetchWithTimeout(url, ms = 8000) {
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PropsEdge/1.0)" },
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Serve from cache (15 min TTL)
  try {
    const cached = await kv.get("news:latest");
    if (cached) return res.status(200).json(cached);
  } catch (_) {}

  const items = [];

  // Fetch news headlines from all sports in parallel
  const newsResults = await Promise.allSettled(ESPN_FEEDS.map(async ({ sport, url }) => {
    const d = await fetchWithTimeout(url);
    const skip = /highlights|game recap|box score|final score|how to watch|where to watch|preview and prediction/i;
    return (d.articles || [])
      .filter(a => !skip.test(a.headline || "") && !skip.test(a.title || ""))
      .slice(0, 5)
      .map(a => {
        const headline = a.headline || a.title || "";
        const desc = a.description || "";
        const usefulDesc = desc && desc.toLowerCase() !== headline.toLowerCase() && !headline.includes(desc) ? desc : "";
        // Detect injury-related headlines
        const isInjury = /injur|out |ruled out|questionable|doubtful|day-to-day|concussion|sprain|strain|fracture|surgery|IL /i.test(headline);
        return {
          sport,
          type: isInjury ? "injury" : "news",
          text: headline,
          description: usefulDesc,
          time: timeAgo(a.published),
          link: a.links?.web?.href || "",
        };
      });
  }));

  for (const r of newsResults) {
    if (r.status === "fulfilled") items.push(...r.value);
  }

  // Sort: injuries first
  items.sort((a, b) => {
    if (a.type === "injury" && b.type !== "injury") return -1;
    if (a.type !== "injury" && b.type === "injury") return 1;
    return 0;
  });

  const payload = {
    items: items.slice(0, 30),
    fetchedAt: new Date().toISOString(),
    source: "espn",
  };

  try { await kv.set("news:latest", payload, 900); } catch (_) {} // 15 min cache

  return res.status(200).json(payload);
};
