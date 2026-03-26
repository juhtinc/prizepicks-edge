module.exports = async function handler(req, res) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 10,
      messages: [{ role: "user", content: "say hi" }]
    });
    return res.status(200).json({ ok: true, response: response.content[0].text });
  } catch (err) {
    return res.status(500).json({ error: err.message, status: err.status });
  }
};
