/**
 * api/lore/batch-control.js  →  GET/POST /api/lore/batch-control
 * Feature #4: Pause/resume batch production.
 *
 * GET  ?action=pause&batchId=...&token=...  — pause a batch (from email link)
 * GET  ?action=resume&batchId=...&token=... — resume a paused batch
 * POST { batchId, action: "start" }         — auto-start (called by cron)
 */

const { getBatch, saveBatch, getBatchScripts, saveScript } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  const { action, batchId, token } = req.method === "GET"
    ? req.query
    : (req.body || {});

  if (!batchId) return res.status(400).json({ error: "batchId required" });

  if (req.method === "GET" && token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Invalid token" });
  }
  if (req.method === "POST") {
    const secret = req.headers["x-secret"] || req.query.secret;
    if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
  }

  const batch = await getBatch(batchId);
  if (!batch) return res.status(404).json({ error: "Batch not found" });

  if (action === "pause") {
    batch.status = "Paused";
    await saveBatch(batchId, batch);

    const scripts = await getBatchScripts(batchId);
    await Promise.all(scripts.map(s => {
      s.status = "Paused";
      return saveScript(s.rowId, s);
    }));

    if (req.method === "GET") {
      res.setHeader("Content-Type", "text/html");
      return res.status(200).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:40px">
          <h1>Batch Paused</h1>
          <p>Batch <strong>${batchId}</strong> has been paused. Auto-start is cancelled.</p>
          <p><a href="/api/lore/batch-control?action=resume&batchId=${batchId}&token=${token}">
            Resume Production
          </a></p>
        </body></html>
      `);
    }
    return res.status(200).json({ ok: true, batchId, status: "Paused" });
  }

  if (action === "resume" || action === "start") {
    if (action === "start" && batch.status === "Paused") {
      return res.status(200).json({ ok: true, batchId, status: "Paused", message: "Batch is paused, skipping auto-start" });
    }

    batch.status = "Ready";
    await saveBatch(batchId, batch);

    const scripts = await getBatchScripts(batchId);
    await Promise.all(scripts.map(s => {
      if (s.status === "Paused" || s.status === "Pending") s.status = "Ready";
      return saveScript(s.rowId, s);
    }));

    if (req.method === "GET") {
      res.setHeader("Content-Type", "text/html");
      return res.status(200).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:40px">
          <h1>Batch Resumed</h1>
          <p>Batch <strong>${batchId}</strong> is now active. Production will proceed.</p>
        </body></html>
      `);
    }
    return res.status(200).json({ ok: true, batchId, status: "Ready" });
  }

  return res.status(400).json({ error: "action must be pause, resume, or start" });
};
