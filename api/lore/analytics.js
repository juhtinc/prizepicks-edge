/**
 * api/lore/analytics.js  →  POST /api/lore/analytics
 * Feature #6: Pull YouTube analytics, analyze by story type, save for next week's selection.
 */

const { getVideoAnalytics } = require("./lib/youtube-api");
const { saveAnalytics, getBatchScripts } = require("./lib/kv-lore");
const { getISOWeek } = require("./lib/utils");

module.exports = async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "POST or GET" });

  const secret = req.headers["x-secret"] || req.query.secret;
  const authHeader = req.headers.authorization;
  const expected = process.env.CRON_SECRET;
  if (secret !== expected && authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = new Date();
  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const weekNum = getISOWeek(lastWeek);
  const batchId = `${lastWeek.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;

  const scripts = await getBatchScripts(batchId);
  const videoIds = scripts.map(s => s.youtubeVideoId).filter(Boolean);

  if (!videoIds.length) {
    return res.status(200).json({ ok: true, message: "No published videos found for last week", batchId });
  }

  const startDate = lastWeek.toISOString().split("T")[0];
  const endDate = now.toISOString().split("T")[0];

  let analyticsData;
  try {
    analyticsData = await getVideoAnalytics(videoIds, startDate, endDate);
  } catch (e) {
    return res.status(500).json({ error: "YouTube Analytics API failed", detail: e.message });
  }

  const byType = {};
  const rows = analyticsData.rows || [];
  rows.forEach((row) => {
    const script = scripts.find(s => s.youtubeVideoId === row[0]);
    if (!script) return;
    const type = script.storyType || "unknown";
    if (!byType[type]) byType[type] = { views: 0, retention: 0, subs: 0, count: 0 };
    byType[type].views += row[1] || 0;
    byType[type].retention += row[4] || 0;
    byType[type].subs += row[5] || 0;
    byType[type].count++;
  });

  Object.keys(byType).forEach(type => {
    byType[type].avgViews = Math.round(byType[type].views / byType[type].count);
    byType[type].avgRetention = (byType[type].retention / byType[type].count).toFixed(1);
  });

  const weekOf = now.toISOString().split("T")[0];
  await saveAnalytics(weekOf, { byType, weekOf, batchId });

  return res.status(200).json({ ok: true, weekOf, byType });
};
