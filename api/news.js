const Anthropic = require("@anthropic-ai/sdk");
const kv = require("./_kv");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const cached = await kv.get("news:latest");
    if (cached) return res.status(200).json(cached);

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{
        role: "user",
        content: `Search for the 10 most recent sports injury updates and lineup news across NBA, MLB, NHL, and soccer.
Search: "NBA injury report today", "MLB lineup news today", "sports injury updates today".
Return ONLY a JSON array of exactly 10 items, most recent first:
[{"sport":"NBA","text":"LeBron James questionable vs PHX — knee soreness","time":"2h ago"}]`,
      }],
    });

    let rawText = "";
    for (const b of response.content || []) { if (b.type === "text") rawText += b.text; }
    let items = [];
    const cleaned = rawText.replace(/```json/gi,"").replace(/```/g,"").trim();
    const arr = cleaned.match(/\[[\s\S]*\]/);
    if (arr) { try { items = JSON.parse(arr[0]); } catch(e) { console.error("[news] parse:", e.message); } }
    if (!Array.isArray(items)) items = [];

    const payload = { items, fetchedAt: new Date().toISOString() };
    await kv.set("news:latest", payload, 1800);
    return res.status(200).json(payload);

  } catch (err) {
    console.error("[news] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
