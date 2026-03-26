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
        content: `Today is ${today}. You are compiling real PrizePicks prop lines from multiple sources. Run ALL of these searches before returning results:

1. Search "site:lineups.com/prizepicks PrizePicks props today"
2. Search "lineups.com PrizePicks today"
3. Search "site:rotowire.com player props today PrizePicks"
4. Search "site:pickswise.com PrizePicks picks today"
5. Search "site:oddsjam.com PrizePicks props today"
6. Search "site:bettingpros.com PrizePicks picks today"
7. Search "r/prizepicks daily slate today 2026" and "site:reddit.com/r/prizepicks today slate"
8. Search "PrizePicks slate today March 26 2026"
9. Search "@PrizePicks @PrizePicksProps @EamonMcAteer @WatsonPicks @PropBetGuy props today"
10. Search "PrizePicks NBA props today 2026" and "PrizePicks MLB props today 2026"

After all searches: compile every player prop line you found across all sources into one master list, remove duplicates (keep the line that appeared in the most sources), then analyze and select the 20 best picks with the strongest edges.

Use ONLY lines found in search results. Tag each pick as "Confirmed Line" if the exact PrizePicks line was found in at least one source, or "Approximate Line" if you had to estimate from season averages.

You MUST respond with ONLY a JSON array — no text before or after, no explanation, just the raw JSON array starting with [ and ending with ].

Each object must have exactly these fields:
- player (string): full name
- team (string): team abbreviation
- sport (string): NBA, MLB, NHL, etc.
- stat (string): e.g. "Points", "Rebounds", "Strikeouts"
- line (number): the prop line
- direction (string): "OVER" or "UNDER"
- confidence (integer 60-95)
- reasoning (string): name the source(s) where this line was found and cite supporting stats
- tags (array of strings): include "Confirmed Line" or "Approximate Line"`,
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
