const kv = require("./_kv");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Compute yesterday in PT (DST-safe: decrement calendar day, not 86400 s)
  const todayPT = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const [y, m, d] = todayPT.split("-").map(Number);
  const yesterdayStr = new Date(y, m - 1, d - 1).toLocaleDateString("en-CA");

  try {
    const [results, record] = await Promise.all([
      kv.get(`picks:results:${yesterdayStr}`),
      kv.get("picks:record"),
    ]);

    return res.status(200).json({
      results: results || null,
      record: record || { wins: 0, losses: 0 },
      // Use stored date when available to avoid clock-skew mismatch
      date: results?.date || yesterdayStr,
    });

  } catch (err) {
    console.error("[results] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
