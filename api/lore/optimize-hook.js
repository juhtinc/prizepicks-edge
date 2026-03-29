/**
 * api/lore/optimize-hook.js  →  POST /api/lore/optimize-hook
 * Feature #7: Dedicated Claude node that ONLY optimizes the first 3 seconds.
 * Separate from metadata generation for focused hook quality.
 *
 * Body: { rowId }
 * Auth: x-secret header
 */

const { askClaudeJSON } = require("./lib/claude");
const { getScript, saveScript } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId } = req.body || {};
  if (!rowId) return res.status(400).json({ error: "rowId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  const prompt = `You are a YouTube Shorts retention expert. The first 3 seconds determine whether someone keeps watching.

Here is a script for a sports history Short about ${script.playerName}:
${script.script}

Rewrite ONLY the first 1-2 sentences (the hook). The rest stays exactly the same.

Requirements for the hook:
- Must create immediate curiosity (viewer NEEDS to know what happens next)
- Use one of these proven patterns:
  a) Shocking stat: "This man averaged 40 points and nobody remembers him"
  b) Bold claim: "The NBA literally changed its rules because of one player"
  c) Direct challenge: "You've never heard of the greatest passer in NBA history"
  d) Time pressure: "In 1986, one game changed basketball forever"
- Maximum 15 words
- No clickbait that the video doesn't deliver on
- The hook must connect to the actual story

Return JSON:
{"hook":"...","pattern_used":"shocking_stat|bold_claim|direct_challenge|time_pressure","original_first_line":"..."}`;

  const result = await askClaudeJSON(prompt, { maxTokens: 300 });

  script.hookLine = result.hook;
  script.hookPattern = result.pattern_used;

  await saveScript(rowId, script);

  return res.status(200).json({ ok: true, rowId, hook: result });
};
