const Anthropic = require("@anthropic-ai/sdk");
const kv = require("./_kv");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-secret, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();
  const secret = req.headers["x-secret"] || req.query?.secret;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET)
    return res.status(401).json({ error: "Unauthorized" });
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: "You are an elite sports betting analyst. Today is " + today + ". Search for recent player news, injuries, and matchups for NBA, MLB, NHL, and any other active sports today. Then give me your 14 best player prop picks for today — use realistic lines based on player averages and recent performance. For each pick search for news to back it up. You MUST return picks regardless of whether you find exact PrizePicks lines — use your best judgment on realistic prop values. Return ONLY a valid JSON array, no markdown, no backticks, no explanation. Each object must have: player (string), team (string), sport (string), stat (string), line (number), direction (OVER or UNDER), confidence (integer 60-95), reasoning (string, 3-4 sentences with specific facts), tags (array of strings). Return ONLY the JSON array starting with [ and ending with ]." }]
    });
    let rawText = "";
    for (const block of response.content || []) { if (block.type === "text") rawText += block.text; }
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON found. Raw: " + rawText.slice(0, 300));
    const picks = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(picks) || picks.length === 0) throw new Error("Empty picks");
    const leaguesSeen = [...new Set(picks.map(p => p.sport).filter(Boolean))];
    await kv.set("picks:latest", { picks, scrapedAt: new Date().toISOString(), analyzedAt: new Date().toISOString(), leaguesSeen, totalProps: picks.length }, 86400 * 2);
    return res.status(200).json({ ok: true, total: picks.length, leagues: leaguesSeen });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
