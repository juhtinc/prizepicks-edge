const Anthropic = require("@anthropic-ai/sdk");
const kv = require("./_kv");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-secret, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const authBearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  const secret = req.headers["x-secret"] || req.query?.secret || authBearer;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  try {
    console.log("[refresh] Starting AI analysis...");

    // Archive current picks before overwriting (isolated — failure must not block refresh)
    try {
      const prev = await kv.get("picks:latest");
      if (prev) {
        const picksForDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
        await kv.set("picks:previous", { ...prev, picksForDate }, 86400 * 2);
        console.log("[refresh] Archived picks:latest to picks:previous for date", picksForDate);
      }
    } catch (archiveErr) {
      console.error("[refresh] Archive step failed (non-fatal):", archiveErr.message);
    }

    const systemPrompt = "You are a JSON API. You only ever respond with valid JSON arrays. Never include any text, explanation, or markdown outside of the JSON array.";

    const researchPrompt = `Today is ${today}. You are a sharp sports analyst finding the 15 best PrizePicks edges using deep research across all available sports. Work through these phases carefully:

PHASE 1 — Find today's PrizePicks lines (search in this priority order):
1. Search "lineups.com PrizePicks today" — primary source
2. Search "rotowire PrizePicks props today"
3. Search "reddit r/prizepicks slate today ${today}"
4. Search "Twitter PrizePicks props today" (look for @PrizePicks @PrizePicksProps @lineupshq)
5. Search "oddsjam prizepicks today" and "pickswise prizepicks today" and "bettingpros prizepicks today"
For tennis: also search "PrizePicks tennis props today" and "lineups.com prizepicks tennis" and "tennisabstract.com" and "atptour.com match today"
For esports: also search "PrizePicks esports props today" and "PrizePicks Valorant props today" and "PrizePicks Dota2 props today" and "vlr.gg today" and "gol.gg today" and "hltv.org today" and "dotabuff.com today"
For other sports: also search "PrizePicks golf props today" and "PrizePicks UFC props today" and "PrizePicks MLS soccer props today"
Build a candidate list of 25-35 players across NBA, MLB, NHL, Soccer/MLS, Tennis, Esports (Valorant/LoL/CS2/Dota2/Rocket League), Golf, and MMA/UFC with their exact PrizePicks lines.

PHASE 2 — Deep research on each candidate (do ALL of these for each player):
Standard research (all sports):
- Search "[player name] last 10 games stats [sport]"
- Search "[player name] injury status today"
- Search "[player name] vs [tonight's opponent] history"
- Search "[team name] defensive ranking vs [player position]"
- Search "rotowire [player name] projection today"
- Search "PrizePicks [player name] line movement today" — note if line has moved and in which direction
- Search "[player name] public betting percentage today" — note public split
- Search "Underdog Fantasy [player name] line today" and "Sleeper props [player name] today" — note alt lines
- Search "[team name] schedule context back to back rest" — flag trap games

For MLB/NFL only:
- Search "[city] [stadium] weather forecast today" — flag adverse weather (wind >15mph, rain, cold)

For Tennis specifically:
- Search "[player name] H2H vs [opponent]"
- Search "[player name] surface record [surface type]"
- Search "[player name] ATP/WTA ranking ace rate first serve percentage"

For Esports specifically:
- Search "[team name] recent match results [game]"
- Search "[player name] recent performance stats [game]"
- Search "tournament context [team name] [game] today"

PHASE 3 — Cross-reference and select 15 best picks:
- Compare projections vs PrizePicks lines
- Only include a pick if at least 2 sources support the edge
- Rank by edge size and pick the 15 absolute best across all sports

Use this exact JSON schema for each pick (you will output the JSON array in the next turn):
- player (string): full name
- team (string): team abbreviation
- opponent (string|null): opponent team abbreviation, or null if unknown
- sport (string): NBA, MLB, NHL, Soccer, Tennis, Valorant, LoL, CS2, Dota2, RocketLeague, Golf, MMA, or other
- stat (string): e.g. "Points", "Rebounds", "Kills", "Aces", "Fantasy Score"
- line (number): the actual PrizePicks line
- line_open (number|null): opening line if found via line movement search, else null
- direction (string): "OVER" or "UNDER"
- confidence (integer 60-95): scale with edge size — 90+ only if gap is very large and multiple sources agree
- sharp_move (boolean|null): true if line moved >1 point in our direction, false if moved against, null if unknown
- public_fade (boolean|null): true if public is 75%+ on the OTHER side (we are fading public), else null
- public_pct (integer|null): percentage of public on OUR side (0-100), or null if unknown
- weather_flag (boolean|null): true if adverse weather detected for MLB/NFL, null for all other sports
- trap_game (boolean|null): true if schedule trap detected (back-to-back, travel, letdown spot), else null
- alt_lines (object|null): {"underdog": number|null, "sleeper": number|null} if found, else null
- reasoning (string): MUST include last 5 and 10 game averages, opponent context, projection vs line, line movement info, public split, and specifically why this line is mispriced. For tennis include H2H, surface, serve stats. For esports include team form and meta context.
- tags (array of strings): include "RotoWire Edge" if projection found, "Confirmed Line" if from lineups.com, "Approximate Line" if estimated, "Sharp Action" if sharp_move is true, "Fade Public" if public_fade is true, "Weather Factor" if weather_flag is true, "Trap Spot" if trap_game is true`;

    // Turn 1: research with web search
    const researchResponse = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 16000,
      system: systemPrompt,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: researchPrompt }],
    });

    let researchText = "";
    for (const block of researchResponse.content || []) {
      if (block.type === "text") researchText += block.text;
    }
    console.log("[refresh] Research phase done, requesting JSON output...");

    // Turn 2: force pure JSON array output
    const jsonResponse = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 8000,
      system: systemPrompt,
      messages: [
        { role: "user", content: researchPrompt },
        { role: "assistant", content: researchText || "Research complete." },
        { role: "user", content: "Now output ONLY the JSON array from your research. Start your response with [ and end with ]. No other text whatsoever." },
      ],
    });

    let rawText = "";
    for (const block of jsonResponse.content || []) {
      if (block.type === "text") rawText += block.text;
    }

    console.log("[refresh] Raw AI response:", rawText.slice(0, 500));

    // Strip markdown fences
    let cleaned = rawText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    // Try to extract [ ... ] array
    let picks = null;
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try { picks = JSON.parse(arrayMatch[0]); } catch (e) {
        console.error("[refresh] Array match parse failed:", e.message);
      }
    }

    // Fallback: try parsing the whole cleaned response
    if (!picks) {
      try { picks = JSON.parse(cleaned); } catch (e) {
        console.error("[refresh] Full parse failed:", e.message);
      }
    }

    function detectCorrelations(picks) {
      const gameGroups = {};
      for (const pick of picks) {
        const key = [pick.team, pick.opponent].filter(Boolean).sort().join(':');
        if (!key) continue;
        if (!gameGroups[key]) gameGroups[key] = [];
        gameGroups[key].push(pick);
      }
      for (const group of Object.values(gameGroups)) {
        if (group.length < 2) continue;
        for (const pick of group) {
          const teammates = group.filter(q => q !== pick && q.team === pick.team);
          const opponents = group.filter(q => q !== pick && q.team !== pick.team);
          if (teammates.length > 0) {
            pick.correlation = { group: `${pick.team} game`, note: "Same team — consider parlaying on a big game night" };
          } else if (opponents.length > 0) {
            pick.correlation = { group: `${pick.team} vs ${pick.opponent || 'Opponent'}`, note: "Opposing teams — game script dependent" };
          }
        }
      }
      return picks;
    }
    if (Array.isArray(picks)) picks = detectCorrelations(picks);

    if (!Array.isArray(picks) || picks.length === 0) {
      throw new Error("No JSON array in response. Raw: " + rawText.slice(0, 300));
    }

    const leaguesSeen = [...new Set(picks.map(p => p.sport).filter(Boolean))];

    console.log("[refresh] Saving", picks.length, "picks to KV...");
    await kv.set("picks:latest", {
      picks,
      scrapedAt: new Date().toISOString(),
      analyzedAt: new Date().toISOString(),
      leaguesSeen,
      totalProps: picks.length,
    }, 86400 * 2);

    console.log("[refresh] KV save done. Returning", picks.length, "picks.");
    return res.status(200).json({ ok: true, total: picks.length });

  } catch (err) {
    console.error("[refresh] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
