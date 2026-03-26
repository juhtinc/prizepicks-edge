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
    const [results, record, clvRecord] = await Promise.all([
      kv.get(`picks:results:${yesterdayStr}`),
      kv.get("picks:record"),
      kv.get("picks:clv_record"),
    ]);

    return res.status(200).json({
      results: results || null,
      record: record || { wins: 0, losses: 0 },
      clv_record: clvRecord || { positive: 0, negative: 0, avg: 0 },
      date: results?.date || yesterdayStr,
    });

  } catch (err) {
    console.error("[results] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
