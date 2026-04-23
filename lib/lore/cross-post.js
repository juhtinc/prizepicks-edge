/**
 * api/lore/cross-post.js  →  POST /api/lore/cross-post
 * Feature #10: Cross-post a published YouTube video to TikTok + Instagram Reels.
 */

const { postToTikTok, postToInstagram } = require("./lib/cross-post");
const { getScript, saveScript } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId, videoUrl } = req.body || {};
  if (!rowId || !videoUrl) return res.status(400).json({ error: "rowId and videoUrl required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  const title = script.titleUsed || script.titleA;
  const description = script.description || "";

  const results = {};

  try {
    results.tiktok = await postToTikTok({ title, description, videoUrl });
    // NOTE: @coldvault handle still needs to be claimed on TikTok (see wiki handoff)
    if (results.tiktok.ok) script.tiktokUrl = `https://tiktok.com/@coldvault`;
  } catch (e) {
    results.tiktok = { ok: false, error: e.message };
  }

  try {
    results.instagram = await postToInstagram({ description, videoUrl });
    // NOTE: coldvault handle still needs to be claimed on Instagram (see wiki handoff)
    if (results.instagram.ok) script.instagramUrl = `https://instagram.com/coldvault`;
  } catch (e) {
    results.instagram = { ok: false, error: e.message };
  }

  await saveScript(rowId, script);

  return res.status(200).json({ ok: true, rowId, results });
};
