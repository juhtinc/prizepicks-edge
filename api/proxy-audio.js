/**
 * api/proxy-audio.js — Proxy audio files to bypass CORS/CSP
 * Usage: GET /api/proxy-audio?url=<encoded-url>&secret=<token>
 */
module.exports = async function handler(req, res) {
  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "url required" });

  try {
    const resp = await fetch(url, { redirect: 'follow' });
    if (!resp.ok) return res.status(resp.status).json({ error: `Upstream ${resp.status}` });
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.setHeader('Content-Type', resp.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(buffer);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
