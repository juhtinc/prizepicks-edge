const Anthropic = require("@anthropic-ai/sdk");
const kv = require("./_kv");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-secret, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const secret = req.headers["x-secret"] || req.query?.secret;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  try {
    console.log("[refresh] Starting AI analysis...");

    // Archive current picks before overwriting
    const prev = await kv.get("picks:latest");
    if (prev) {
      const picksForDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
      await kv.set("picks:previous", { ...prev, picksForDate }, 86400 * 2);
      console.log("[refresh] Archived picks:latest to picks:previous for date", picksForDate);
    }

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 16000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{
        role: "user",
        content: `Today is ${today}. You are a sharp sports analyst finding the 12 best PrizePicks edges using deep research. Work through these phases carefully:

PHASE 1 — Find today's PrizePicks lines:
- Search "lineups.com PrizePicks today" and record every player, stat, and line you find
- Search "PrizePicks slate today ${today}" to cross-reference
- Build a candidate list of 20-30 players with their exact PrizePicks lines

PHASE 2 — Deep research on each candidate (do ALL of these searches):
For each candidate player:
- Search "[player name] last 10 games stats [sport]"
- Search "[player name] injury status today"
- Search "[player name] vs [tonight's opponent] history"
- Search "[team name] defensive ranking vs [player position]"
- Search "rotowire [player name] projection today"

PHASE 3 — Cross-reference and select:
- Compare RotoWire projections vs PrizePicks lines — projection above line = OVER edge, below = UNDER edge
- Only include a pick if at least 2 sources support the edge
- Rank by edge size (projection vs line gap) and pick the 12 absolute best

You MUST respond with ONLY a JSON array — no text before or after, no explanation, just the raw JSON array starting with [ and ending with ].

Each object must have exactly these fields:
- player (string): full name
- team (string): team abbreviation
- sport (string): NBA, MLB, NHL, etc.
- stat (string): e.g. "Points", "Rebounds", "Strikeouts"
- line (number): the actual PrizePicks line
- direction (string): "OVER" or "UNDER"
- confidence (integer 60-95): scale with edge size — 90+ only if gap is very large and multiple sources agree
- reasoning (string): MUST include last 5 and 10 game averages, opponent defensive ranking, any injury/rest info, the RotoWire or expert projection vs the PrizePicks line, and specifically why this line is mispriced
- tags (array of strings): include "RotoWire Edge" if projection found, "Confirmed Line" if from lineups.com, "Approximate Line" if estimated`,
      }],
    });

    let rawText = "";
    for (const block of response.content || []) {
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
