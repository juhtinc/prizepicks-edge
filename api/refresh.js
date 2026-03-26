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

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{
        role: "user",
        content: `Today is ${today}. You are finding real PrizePicks lines and cross-referencing them against RotoWire projections to identify the biggest edges. Follow these steps in order:

STEP 1 — Get the actual PrizePicks lines:
- Search "lineups.com PrizePicks NBA today"
- Search "lineups.com PrizePicks picks today"
- Search "PrizePicks slate today ${today}"
Record every player name, stat, and line number you find.

STEP 2 — Get RotoWire projections for those players:
- Search "rotowire.com PrizePicks NBA today"
- Search "rotowire player projections today NBA"
- Search "rotowire.com prizepicks picks today"
For each player from Step 1, find RotoWire's projected stat total.

STEP 3 — Find the edges:
For each player where you have both a PrizePicks line AND a RotoWire projection:
- If RotoWire projects HIGHER than the PrizePicks line → strong OVER edge
- If RotoWire projects LOWER than the PrizePicks line → strong UNDER edge
- The bigger the gap between projection and line, the higher the confidence
Prioritize picks where the RotoWire projection differs from the PrizePicks line by the largest margin.

STEP 4 — Supplement with other sources if needed to reach 20 picks:
- Search "pickswise.com PrizePicks picks today"
- Search "bettingpros.com PrizePicks today"

After all steps, return the 20 best picks ranked by edge size. You MUST respond with ONLY a JSON array — no text before or after, no explanation, just the raw JSON array starting with [ and ending with ].

Each object must have exactly these fields:
- player (string): full name
- team (string): team abbreviation
- sport (string): NBA, MLB, NHL, etc.
- stat (string): e.g. "Points", "Rebounds", "Strikeouts"
- line (number): the actual PrizePicks line
- direction (string): "OVER" or "UNDER"
- confidence (integer 60-95): higher when RotoWire gap is larger
- reasoning (string): state the PrizePicks line, the RotoWire projection, the gap, and why it's the right side
- tags (array of strings): include "RotoWire Edge" if cross-referenced, "Confirmed Line" if line was found on lineups.com, or "Approximate Line" if estimated`,
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
