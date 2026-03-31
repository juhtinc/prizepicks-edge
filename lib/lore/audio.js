/**
 * lib/lore/audio.js  →  GET /api/lore?route=audio&id=...
 * Serves voiceover audio stored in KV as base64.
 * Used by Creatomate to fetch audio during video rendering.
 */

const kv = require("../../api/_kv");

module.exports = async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "id required" });

  const base64 = await kv.get(`lore:audio:${id}`);
  if (!base64) return res.status(404).json({ error: "Audio not found or expired" });

  const buffer = Buffer.from(base64, "base64");
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Length", buffer.length);
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.send(buffer);
};
