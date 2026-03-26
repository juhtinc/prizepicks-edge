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
        content: `You are an elite sports betting analyst. Today is ${today}. Search the web for today's PrizePicks player prop lines and identify the 14 best plays with the strongest edges. Include esports if available. For each pick search for recent news and injuries to back it up. Return ONLY a valid JSON array, no markdown, no backticks. Each object must have exactly: { "player": "Name", "team": "TEAM", "sport": "NBA", "stat": "Points", "line": 24.5, "direction": "OVER", "confidence": 82, "reasoning": "3-4 sentences with specific facts.", "tags": ["Tag1", "Tag2"] }. Return ONLY the JSON array.`
      }]
    });

    let rawText = "";
    for (const block of response.content || []) {
      if (block.type === "text") rawText += block.text;
    }

    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON returned from AI");

    const picks = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(picks) || picks.length === 0) throw new Error("Empty picks");

    const leaguesSeen = [...new Set(picks.map(p => p.sport).filter(Boolean))];

    await kv.set("picks:latest", {
      picks,
      scrapedAt: new Date().toISOString(),
      analyzedAt: new Date().toISOString(),
      leaguesSeen,
      totalProps: picks.length,
    }, 86400 * 2);

    return res.status(200).json({ ok: true, total: picks.length });

  } catch (err) {
    console.error("[refresh] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};