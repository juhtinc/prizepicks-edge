/**
 * api/lore/generate-metadata.js  →  POST /api/lore/generate-metadata
 * Feature #1: Generate title, description, hashtags, and hook line for a script.
 *
 * Body: { rowId } — reads script from KV, generates metadata, saves back
 * Auth: x-secret header
 */

const { askClaudeJSON } = require("./lib/claude");
const { getScript, saveScript } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET)
    return res.status(401).json({ error: "Unauthorized" });

  const { rowId } = req.body || {};
  if (!rowId) return res.status(400).json({ error: "rowId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  const prompt = `You are a viral YouTube Shorts title expert for sports history content.

Given this script about ${script.playerName} (${script.storyType}):
${script.script}

Generate:
1. title_a: A curiosity-gap hook title (5-8 words, makes viewer NEED to know). Example: "The NBA Banned Him For Being Too Good"
2. title_b: A bold claim title (5-8 words). Example: "Nobody Remembers The Best Shooter Ever"
3. description: 2-3 sentences with keywords for YouTube SEO (include player name, team, era)
4. hashtags: 7 hashtags, mix of broad (#shorts #nba #basketball) and specific (#playername)

NOTE: Do NOT rewrite the hook line — that is handled by a separate optimization pass.

Return JSON only:
{"title_a":"...","title_b":"...","description":"...","hashtags":["..."]}`;

  const metadata = await askClaudeJSON(prompt, { maxTokens: 500 });

  script.titleA = metadata.title_a;
  script.titleB = metadata.title_b;
  script.description = metadata.description;
  script.hashtags = metadata.hashtags;
  // hookLine is NOT overwritten here — optimize-hook.js owns the hook

  await saveScript(rowId, script);

  return res.status(200).json({ ok: true, rowId, metadata });
};
