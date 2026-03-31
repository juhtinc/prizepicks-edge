/**
 * api/lore/generate-thumbnail.js  →  POST /api/lore/generate-thumbnail
 * Feature #2: Generate thumbnail via Creatomate for a script.
 */

const { renderThumbnail } = require("./lib/creatomate");
const { getScript, saveScript } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId } = req.body || {};
  if (!rowId) return res.status(400).json({ error: "rowId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  if (!process.env.CREATOMATE_API_KEY) {
    return res.status(200).json({ ok: true, rowId, message: "Creatomate not configured, skipping thumbnail" });
  }

  const hookText = script.hookLine || script.titleA || script.playerName;

  const result = await renderThumbnail({
    playerName: script.playerName,
    hookText,
    playerImageUrl: script.playerPhotoUrl,
    accentColor: "#FF4444",
  });

  script.thumbnailUrl = result.url || "";
  await saveScript(rowId, script);

  return res.status(200).json({ ok: true, rowId, thumbnail: result });
};
