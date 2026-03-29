/**
 * api/lore/ab-test.js  →  POST /api/lore/ab-test
 * Feature #8: Track which title (A or B) was used and its performance.
 */

const { getScript, saveScript, getBatchScripts } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") {
    const { batchId } = req.query;
    if (!batchId) return res.status(400).json({ error: "batchId required" });

    const scripts = await getBatchScripts(batchId);
    const results = scripts.map(s => ({
      rowId: s.rowId,
      titleA: s.titleA,
      titleB: s.titleB,
      titleUsed: s.titleUsed,
      viewsAt48h: s.viewsAt48h,
    }));

    return res.status(200).json({ ok: true, results });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });

  const { rowId, version } = req.body || {};
  if (!rowId) return res.status(400).json({ error: "rowId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  if (version === "A" || version === "B") {
    script.titleUsed = version === "A" ? script.titleA : script.titleB;
    script.titleVersion = version;
  } else {
    const useB = new Date().getDay() % 2 === 0;
    script.titleUsed = useB ? script.titleB : script.titleA;
    script.titleVersion = useB ? "B" : "A";
  }

  await saveScript(rowId, script);
  return res.status(200).json({ ok: true, rowId, titleUsed: script.titleUsed, version: script.titleVersion });
};
