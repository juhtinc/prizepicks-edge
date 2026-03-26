/**
 * api/cron.js  →  GET /api/cron
 * Called automatically by Vercel's cron scheduler (see vercel.json).
 * Schedule: 9am PT (17:00 UTC), 1pm PT (21:00 UTC), 6pm PT (02:00 UTC+1)
 * Protected by Vercel's built-in CRON_SECRET header injection.
 */

const refreshHandler = require("./refresh");

module.exports = async function handler(req, res) {
  // Vercel injects Authorization: Bearer $CRON_SECRET for cron jobs
  const authHeader = req.headers.authorization;
  const expected = process.env.CRON_SECRET;

  if (expected && authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Forward to refresh handler (it accepts x-secret or secret query param)
  req.headers["x-secret"] = expected || "";
  return refreshHandler(req, res);
};
