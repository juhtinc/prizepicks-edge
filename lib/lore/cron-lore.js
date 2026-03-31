/**
 * api/lore/cron-lore.js  →  GET /api/lore/cron-lore
 * Central cron dispatcher for all Sports Lore scheduled workflows.
 *
 * Schedule (2 videos/day, 14/week):
 *   Sunday 8PM EST     → analytics (pulls last week's performance)
 *   Sunday 9PM EST     → weekly-batch A (Mon-Thu stories, 7 videos)
 *   Wednesday 9PM EST  → weekly-batch B (Thu-Sun stories, 7 videos)
 *   Daily 6AM EST      → auto-start (produces today's 2 videos)
 *   Daily 10AM EST     → performance-check (48h underperformer detection)
 *   Every hour          → comments (monitoring + auto-pin after 12h)
 *
 * Query: ?workflow=analytics|weekly-batch|auto-start|performance-check|comments|auto-pin
 *        &batch=A|B (for weekly-batch, auto-detected if not set)
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
  const batch = req.query.batch || "";

  try {
    switch (workflow) {
      case "analytics": {
        const resp = await axios.post(`${baseUrl}/api/lore?route=analytics`, {}, { headers });
        return res.status(200).json({ workflow, result: resp.data });
      }

      case "weekly-batch": {
        // batch=A or batch=B determines which half of the week
        const batchParam = batch || (new Date().getDay() <= 2 ? "A" : "B");
        const resp = await axios.post(
          `${baseUrl}/api/lore?route=weekly-batch&phase=plan&batch=${batchParam}`,
          {},
          { headers }
        );
        return res.status(200).json({ workflow, batch: batchParam, result: resp.data });
      }

      case "auto-start": {
        // Daily: find today's scripts from BOTH batches and produce them
        const now = new Date();
        const today = now.toISOString().split("T")[0];
        const baseBatchId = getBatchIdForDate(now);
        const started = [];

        for (const half of ["A", "B"]) {
          const bid = `${baseBatchId}-${half}`;
          const batch = await getBatch(bid);
          if (!batch || batch.status === "Paused") continue;

          const scripts = await getBatchScripts(bid);
          // Find scripts scheduled for today that haven't been produced yet
          const todayScripts = scripts.filter(s =>
            s.scheduledDate === today &&
            (s.status === "Pending" || s.status === "Ready" || s.status === "Review")
          );

          todayScripts.forEach(script => {
            axios.post(`${baseUrl}/api/lore?route=video-production`, { rowId: script.rowId }, { headers }).catch(e => {
              console.error(`[auto-start] Production failed for ${script.rowId}:`, e.message);
            });
            started.push(script.rowId);
          });
        }

        return res.status(200).json({ workflow, today, started: started.length, rowIds: started });
      }

      case "performance-check": {
        const resp = await axios.post(`${baseUrl}/api/lore?route=performance-check`, {}, { headers });
        return res.status(200).json({ workflow, result: resp.data });
      }

      case "comments": {
        const resp = await axios.post(`${baseUrl}/api/lore?route=comments`, {}, { headers });
        return res.status(200).json({ workflow, result: resp.data });
      }

      case "auto-pin": {
        // Pin top-liked comment after 12 hours
        const resp = await axios.post(`${baseUrl}/api/lore?route=comments&action=auto-pin`, {}, { headers });
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
