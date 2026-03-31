/**
 * api/lore/clip-feedback.js  →  GET /api/lore/clip-feedback
 * Feature #3: Webhook to log clip rejections.
 */

const { addRejection, getScript } = require("./lib/kv-lore");

const VALID_REASONS = ["wrong_player", "low_res", "irrelevant", "wrong_sport", "too_short", "bad_audio"];

module.exports = async function handler(req, res) {
  const { rowId, reason, token } = req.query;

  if (token !== process.env.CRON_SECRET) return res.status(401).json({ error: "Invalid token" });
  if (!rowId || !reason) return res.status(400).json({ error: "rowId and reason required" });

  const reasons = reason.split(",").filter(r => VALID_REASONS.includes(r));
  if (!reasons.length) return res.status(400).json({ error: `Invalid reason. Use: ${VALID_REASONS.join(", ")}` });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  await addRejection(rowId, reasons);

  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(`
    <html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h1>Clip Rejection Logged</h1>
      <p>Recorded <strong>${reasons.join(", ")}</strong> for ${script.playerName} (${script.rowId})</p>
      <p>This feedback improves future clip sourcing.</p>
    </body></html>
  `);
};
