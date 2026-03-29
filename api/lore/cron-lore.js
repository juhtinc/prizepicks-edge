/**
 * api/lore/cron-lore.js  →  GET /api/lore/cron-lore
 * Central cron dispatcher for all Sports Lore scheduled workflows.
 *
 * Query: ?workflow=analytics|weekly-batch|auto-start|performance-check|comments
 */

const axios = require("axios");
const { getBatch, getBatchScripts } = require("./lib/kv-lore");
const { getBatchIdForDate } = require("./lib/utils");

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const workflow = req.query.workflow;
  if (!workflow) return res.status(400).json({ error: "workflow query param required" });

  const baseUrl = `https://${req.headers.host}`;
  const headers = { "x-secret": expected, "Content-Type": "application/json" };

  try {
    switch (workflow) {
      case "analytics": {
        const resp = await axios.post(`${baseUrl}/api/lore/analytics`, {}, { headers });
        return res.status(200).json({ workflow, result: resp.data });
      }

      case "weekly-batch": {
        const resp = await axios.post(`${baseUrl}/api/lore/weekly-batch?phase=stories`, {}, { headers });
        return res.status(200).json({ workflow, result: resp.data });
      }

      case "auto-start": {
        const batchId = getBatchIdForDate(new Date());
        const batch = await getBatch(batchId);
        if (!batch) return res.status(200).json({ workflow, message: "No batch found" });

        if (batch.status === "Paused") {
          return res.status(200).json({ workflow, message: "Batch is paused, skipping auto-start" });
        }

        const scripts = await getBatchScripts(batchId);
        const readyScripts = scripts.filter(s => s.status === "Pending" || s.status === "Ready");

        readyScripts.forEach(script => {
          axios.post(`${baseUrl}/api/lore/video-production`, { rowId: script.rowId }, { headers }).catch(e => {
            console.error(`[auto-start] Production failed for ${script.rowId}:`, e.message);
          });
        });

        return res.status(200).json({ workflow, started: readyScripts.length });
      }

      case "performance-check": {
        const resp = await axios.post(`${baseUrl}/api/lore/performance-check`, {}, { headers });
        return res.status(200).json({ workflow, result: resp.data });
      }

      case "comments": {
        const resp = await axios.post(`${baseUrl}/api/lore/comments`, {}, { headers });
        return res.status(200).json({ workflow, result: resp.data });
      }

      default:
        return res.status(400).json({ error: `Unknown workflow: ${workflow}` });
    }
  } catch (e) {
    console.error(`[cron-lore] ${workflow} failed:`, e.message);
    return res.status(500).json({ error: e.message, workflow });
  }
};
