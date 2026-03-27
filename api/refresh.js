// ── ANTHROPIC API CALLED HERE ONLY ─────────────────────────────────────────
// This is the ONLY file in the project that calls the Anthropic API.
// It is triggered exclusively by:
//   1. Manual user click of the "Refresh Picks" button (POST with x-secret header)
//   2. Vercel cron jobs (api/cron.js, Authorization: Bearer $CRON_SECRET)
// Never called automatically from the frontend.
// ────────────────────────────────────────────────────────────────────────────
const Anthropic = require("@anthropic-ai/sdk");
const kv = require("./_kv");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Odds API config ────────────────────────────────────────────────────────────
// Sports covered by The Odds API player props endpoint.
// For everything else (Tennis, Esports, Golf, MMA) Claude still web-searches.
const ODDS_SPORTS = [
  {
    sport: "NBA", key: "basketball_nba",
    markets: "player_points,player_rebounds,player_assists,player_threes,player_blocks,player_steals,player_points_rebounds_assists",
  },
  {
    sport: "MLB", key: "baseball_mlb",
    markets: "batter_hits,pitcher_strikeouts,batter_home_runs,batter_rbis,batter_total_bases",
  },
  {
    sport: "NHL", key: "icehockey_nhl",
    markets: "player_goals,player_assists,player_shots_on_goal,player_blocked_shots",
  },
  {
    sport: "NFL", key: "americanfootball_nfl",
    markets: "player_pass_yds,player_rush_yds,player_reception_yds,player_receptions,player_pass_tds",
  },
];

const MARKET_LABEL = {
  player_points: "Points", player_rebounds: "Rebounds", player_assists: "Assists",
  player_threes: "3-Pointers Made", player_blocks: "Blocks", player_steals: "Steals",
  player_points_rebounds_assists: "Pts+Reb+Ast",
  batter_hits: "Hits", pitcher_strikeouts: "Strikeouts", batter_home_runs: "Home Runs",
  batter_rbis: "RBIs", batter_total_bases: "Total Bases",
  player_goals: "Goals", player_shots_on_goal: "Shots on Goal", player_blocked_shots: "Blocked Shots",
  player_pass_yds: "Pass Yards", player_rush_yds: "Rush Yards",
  player_reception_yds: "Receiving Yards", player_receptions: "Receptions",
  player_pass_tds: "Pass TDs",
};

function shortBook(key) {
  const m = { draftkings: "DK", fanduel: "FD", betmgm: "MGM", pointsbet: "PB", caesars: "CZ", bovada: "BV", betonlineag: "BOL", mybookieag: "MB" };
  return m[key] || key.slice(0, 3).toUpperCase();
}

// ── Fetch sportsbook player props ──────────────────────────────────────────────
// Tries KV cache first (populated by /api/lines, 30-min TTL).
// Falls back to a fresh Odds API fetch if the cache is cold.
async function getSportsbookProps(apiKey) {
  // Use cached lines if fresh
  try {
    const cached = await kv.get("lines:combined");
    if (cached?.props?.length) {
      console.log(`[refresh] Using cached Odds API lines (${cached.props.length} props from ${cached.fetchedAt})`);
      return cached.props;
    }
  } catch (_) {}

  console.log("[refresh] No cached lines — fetching fresh from The Odds API...");
  const allProps = [];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const from = new Date(`${today}T00:00:00-07:00`).toISOString();
  const to   = new Date(`${today}T23:59:59-07:00`).toISOString();

  for (const { sport, key, markets } of ODDS_SPORTS) {
    try {
      // Step 1: get today's event IDs
      const evR = await fetch(
        `https://api.the-odds-api.com/v4/sports/${key}/events?apiKey=${apiKey}&dateFormat=iso&commenceTimeFrom=${from}&commenceTimeTo=${to}`,
        { signal: AbortSignal.timeout(9000) }
      );
      if (!evR.ok) { console.warn(`[refresh] ${sport} events HTTP ${evR.status}`); continue; }
      const events = await evR.json();
      const batch = (Array.isArray(events) ? events : []).slice(0, 8); // max 8 events/sport
      console.log(`[refresh] ${sport}: ${events.length} events today, fetching props for ${batch.length}`);

      // Step 2: fetch player props per event
      await Promise.allSettled(batch.map(async event => {
        try {
          const prR = await fetch(
            `https://api.the-odds-api.com/v4/sports/${key}/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${markets}&oddsFormat=american`,
            { signal: AbortSignal.timeout(9000) }
          );
          if (!prR.ok) return;
          const data = await prR.json();

          // Normalize: player+stat → {books}
          const byPk = {};
          for (const bookie of (data.bookmakers || [])) {
            for (const market of (bookie.markets || [])) {
              const statLabel = MARKET_LABEL[market.key] || market.key;
              for (const outcome of (market.outcomes || [])) {
                if (outcome.name !== "Over" || !outcome.description || outcome.point == null) continue;
                const pk = `${outcome.description}|${statLabel}`;
                if (!byPk[pk]) byPk[pk] = { player: outcome.description, stat: statLabel, market: market.key, sport, books: {} };
                byPk[pk].books[bookie.key] = outcome.point;
              }
            }
          }
          allProps.push(...Object.values(byPk));
        } catch (e) {
          console.warn(`[refresh] ${sport} event ${event.id} props failed:`, e.message);
        }
      }));
    } catch (e) {
      console.warn(`[refresh] ${sport} Odds API failed:`, e.message);
    }
  }

  console.log(`[refresh] Fetched ${allProps.length} raw props from Odds API`);
  return allProps;
}

// ── Format props for prompt injection ─────────────────────────────────────────
function buildPropsContext(props) {
  if (!props?.length) return null;

  // Deduplicate by player+stat, merge books
  const merged = {};
  for (const p of props) {
    const k = `${p.player}|${p.stat}`;
    if (!merged[k]) merged[k] = { ...p, books: { ...p.books } };
    else Object.assign(merged[k].books, p.books);
  }

  const lines = Object.values(merged).map(p => {
    const books = Object.entries(p.books);
    if (!books.length) return null;
    const vals = books.map(([, v]) => v);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const gap = max - min >= 0.5 ? ` [⚡ ${(max - min).toFixed(1)}pt book gap]` : "";
    const bookStr = books.map(([b, l]) => `${shortBook(b)}:${l}`).join(" | ");
    return `${p.sport} | ${p.player} | ${p.stat} | ${bookStr}${gap}`;
  }).filter(Boolean);

  return lines.join("\n");
}

// ── Main handler ───────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-secret, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const authBearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  const secret = req.headers["x-secret"] || req.query?.secret || authBearer || req.body?.secret;
  console.log("[refresh] Expected secret:", process.env.CRON_SECRET, "Received:", secret);
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized", received: secret ? "provided but wrong" : "missing" });
  }

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  try {
    console.log("[refresh] Starting...");

    // Archive current picks (non-fatal)
    try {
      const prev = await kv.get("picks:latest");
      if (prev) {
        const picksForDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
        await kv.set("picks:previous", { ...prev, picksForDate }, 86400 * 2);
        console.log("[refresh] Archived picks:latest to picks:previous for", picksForDate);
      }
    } catch (e) {
      console.error("[refresh] Archive failed (non-fatal):", e.message);
    }

    // ── Attempt to load sportsbook lines from The Odds API ──────────────────
    const oddsApiKey = process.env.ODDS_API_KEY;
    let propsContext = null;
    let oddsMode = false;

    if (oddsApiKey) {
      try {
        const props = await getSportsbookProps(oddsApiKey);
        if (props.length >= 10) {
          propsContext = buildPropsContext(props);
          oddsMode = true;
          console.log(`[refresh] Odds API mode active — ${Object.keys(
            props.reduce((a, p) => { a[`${p.player}|${p.stat}`] = 1; return a; }, {})
          ).length} unique player props loaded`);
        } else {
          console.log("[refresh] Odds API returned too few props, falling back to web-search mode");
        }
      } catch (e) {
        console.warn("[refresh] Odds API load failed, falling back:", e.message);
      }
    } else {
      console.log("[refresh] No ODDS_API_KEY — using web-search mode");
    }

    // ── Build prompt ─────────────────────────────────────────────────────────
    const systemPrompt = "You are an expert sports betting analyst. Be extremely concise. Short reasoning only. JSON only. You only ever respond with valid JSON arrays. Never include any text, explanation, or markdown outside of the JSON array.";

    const jsonSchema = `Use this exact JSON schema for each pick:
- player (string): full name
- team (string): team abbreviation
- opponent (string|null): opponent team abbreviation, or null if unknown
- sport (string): NBA, MLB, NHL, NFL, or other
- stat (string): e.g. "Points", "Rebounds", "Strikeouts"
- line (number): the consensus sportsbook line from the data above
- line_open (number|null): opening line if you found line movement data, else null
- direction (string): "OVER" or "UNDER"
- confidence (integer 60-95): higher when recent averages strongly support the direction vs the line
- sharp_move (boolean|null): true if line moved in our direction recently, false if against, null if unknown
- public_fade (boolean|null): true if public is 75%+ on the OTHER side
- public_pct (integer|null): public % on OUR side (0-100), or null
- weather_flag (boolean|null): true if adverse weather for MLB/NFL, null otherwise
- trap_game (boolean|null): true if back-to-back, travel, or letdown spot detected
- alt_lines (object|null): {"dk": number|null, "fd": number|null} per-book lines when books disagree
- injury_severity (string|null): "CRITICAL" / "HIGH" / "MEDIUM" / "LOW" / null
- checklist (object): { injury_checked: bool, lineup_confirmed: bool, weather_checked: bool, line_movement: bool, back_to_back: bool, public_betting: bool, sharp_money: bool, matchup_checked: bool }
- reasoning (string): 2 sentences max. Include the line, recent avg vs line, and why this is a value play
- tags (array of strings): "Sharp Number", "Book Disagreement", "Sharp Action", "Fade Public", "Weather Factor", "Trap Spot"`;

    let researchPrompt;

    if (oddsMode) {
      // ── ODDS API MODE — analyze lines already provided ─────────────────────
      researchPrompt = `Today is ${today}. You are an expert sports betting analyst. Here are today's prop lines from major sportsbooks (DraftKings, FanDuel, BetMGM) via The Odds API:

${propsContext}

DO NOT search for prop lines, odds, schedules, or sportsbook data — it is ALL provided above.

RESEARCH (5 searches maximum):
1. Search "NBA MLB NHL NFL injury report ${today}" — find who is out/questionable
2. Search "NBA MLB NHL lineup confirmations ${today}" — confirm starting lineups
3. Search "MLB NFL weather forecast ${today}" — flag rain/wind for outdoor games
4. Search "sharp money line movement props ${today}" — where is sharp action going
5. Search "NBA NHL back to back schedule ${today}" — flag fatigue/rest spots

Using the lines above + your research, identify the 10 best edges where the market line appears mispriced. Skip injured players. Rank by biggest gap between recent player average and the posted line.

${jsonSchema}`;

    } else {
      // ── NO ODDS API — cannot analyze without lines ─────────────────────────
      researchPrompt = `Today is ${today}. ODDS_API_KEY is not configured. Without sportsbook lines I cannot perform proper analysis. Return an empty JSON array: []

${jsonSchema}`;
    }

    // ── Turn 1: Research with web search ────────────────────────────────────
    console.log(`[refresh] Starting Turn 1 research (${oddsMode ? "Odds API mode" : "web-search mode"})...`);
    const researchResponse = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 3000,
      system: systemPrompt,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: researchPrompt }],
    });

    let researchText = "";
    for (const block of researchResponse.content || []) {
      if (block.type === "text") researchText += block.text;
    }
    console.log("[refresh] Turn 1 done. Requesting JSON output...");

    // ── Turn 2: Force pure JSON output ───────────────────────────────────────
    const jsonResponse = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 3000,
      system: systemPrompt,
      messages: [
        { role: "user", content: researchPrompt },
        { role: "assistant", content: researchText || "Research complete." },
        { role: "user", content: "Now output ONLY the JSON array of your 10 best picks. Start with [ and end with ]. No other text. Keep reasoning to 2 sentences max." },
      ],
    });

    let rawText = "";
    for (const block of jsonResponse.content || []) {
      if (block.type === "text") rawText += block.text;
    }
    console.log("[refresh] Turn 2 raw (first 500):", rawText.slice(0, 500));

    // ── Parse JSON (with fallback extraction) ───────────────────────────────
    let cleaned = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
    let picks = null;

    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try { picks = JSON.parse(arrayMatch[0]); } catch (e) {
        console.error("[refresh] Array match parse failed:", e.message);
      }
    }
    if (!picks) {
      try { picks = JSON.parse(cleaned); } catch (e) {
        console.error("[refresh] Full parse failed:", e.message);
      }
    }

    // ── Detect correlations ──────────────────────────────────────────────────
    function detectCorrelations(arr) {
      const groups = {};
      for (const p of arr) {
        const k = [p.team, p.opponent].filter(Boolean).sort().join(":");
        if (!k) continue;
        if (!groups[k]) groups[k] = [];
        groups[k].push(p);
      }
      for (const group of Object.values(groups)) {
        if (group.length < 2) continue;
        for (const p of group) {
          const teammates = group.filter(q => q !== p && q.team === p.team);
          const opponents  = group.filter(q => q !== p && q.team !== p.team);
          if (teammates.length > 0) {
            p.correlation = { group: `${p.team} game`, note: "Same team — consider parlaying on a big game night" };
          } else if (opponents.length > 0) {
            p.correlation = { group: `${p.team} vs ${p.opponent || "Opponent"}`, note: "Opposing teams — game script dependent" };
          }
        }
      }
      return arr;
    }

    if (Array.isArray(picks)) picks = detectCorrelations(picks);

    if (!Array.isArray(picks) || picks.length === 0) {
      throw new Error("No valid JSON array in response. Raw: " + rawText.slice(0, 300));
    }

    const leaguesSeen = [...new Set(picks.map(p => p.sport).filter(Boolean))];
    console.log(`[refresh] Saving ${picks.length} picks (${leaguesSeen.join(", ")}) to KV...`);

    await kv.set("picks:latest", {
      picks,
      scrapedAt: new Date().toISOString(),
      analyzedAt: new Date().toISOString(),
      leaguesSeen,
      totalProps: picks.length,
      oddsMode,
    }, 86400 * 2);

    console.log("[refresh] Done.");
    return res.status(200).json({ ok: true, total: picks.length, oddsMode });

  } catch (err) {
    console.error("[refresh] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
