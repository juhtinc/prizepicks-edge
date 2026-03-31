/**
 * api/lore/performance-check.js  →  POST /api/lore/performance-check
 * Feature #12: Check 48h performance, queue re-uploads for underperformers.
 */

const { askClaudeJSON } = require("./lib/claude");
const { getVideoAnalytics } = require("./lib/youtube-api");
const { getBatchScripts, saveScript, queueReupload, getRecentAnalytics } = require("./lib/kv-lore");
const { getISOWeek } = require("./lib/utils");

module.exports = async function handler(req, res) {
  const secret = req.headers["x-secret"] || req.query.secret;
  const authHeader = req.headers.authorization;
  const expected = process.env.CRON_SECRET;
  if (secret !== expected && authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = new Date();
  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const checkDate = twoDaysAgo.toISOString().split("T")[0];

  const recentAnalytics = await getRecentAnalytics(4);
  let channelAvgViews = 10000;
  if (recentAnalytics.length > 0) {
    let totalViews = 0, totalCount = 0;
    recentAnalytics.forEach(week => {
      Object.values(week.byType || {}).forEach(t => {
        totalViews += t.avgViews || 0;
        totalCount++;
      });
    });
    if (totalCount > 0) channelAvgViews = totalViews / totalCount;
  }

  const weekNum = getISOWeek(twoDaysAgo);
  const batchId = `${twoDaysAgo.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  const scriptsA = await getBatchScripts(`${batchId}-A`);
  const scriptsB = await getBatchScripts(`${batchId}-B`);
  const scripts = [...scriptsA, ...scriptsB];

  const toCheck = scripts.filter(s =>
    s.scheduledDate === checkDate && s.youtubeVideoId
  );

  if (!toCheck.length) {
    return res.status(200).json({ ok: true, message: "No videos to check for " + checkDate });
  }

  const videoIds = toCheck.map(s => s.youtubeVideoId);
  let analytics;
  try {
    analytics = await getVideoAnalytics(videoIds, checkDate, now.toISOString().split("T")[0]);
  } catch (e) {
    return res.status(500).json({ error: "Analytics API failed", detail: e.message });
  }

  const results = [];
  const rows = analytics.rows || [];

  for (const script of toCheck) {
    const row = rows.find(r => r[0] === script.youtubeVideoId);
    if (!row) continue;

    const views = row[1] || 0;
    const retention = row[4] || 0;

    script.viewsAt48h = views;
    script.retentionAt48h = retention;
    await saveScript(script.rowId, script);

    const isUnderperformer = views < channelAvgViews * 0.4;
    const lowRetention = retention < 30;

    if (isUnderperformer) {
      const reason = lowRetention ? "bad_hook" : "bad_title";

      const prompt = `This YouTube Short about ${script.playerName} underperformed (${views} views, ${retention}% retention).

Original title: "${script.titleUsed || script.titleA}"
Original hook: "${script.hookLine}"

The issue is likely: ${reason === "bad_hook" ? "viewers leave in first 3 seconds — the hook is weak" : "the title doesn't compel clicks"}

Generate a completely different approach:
{"new_title":"...","new_hook":"...","change_rationale":"..."}`;

      const reuploadData = await askClaudeJSON(prompt, { maxTokens: 300 });

      const reuploadDate = new Date(now);
      reuploadDate.setDate(reuploadDate.getDate() + 7);

      await queueReupload(script.youtubeVideoId, {
        originalVideoId: script.youtubeVideoId,
        originalTitle: script.titleUsed || script.titleA,
        originalViews48h: views,
        newTitle: reuploadData.new_title,
        newHook: reuploadData.new_hook,
        rationale: reuploadData.change_rationale,
        scheduledDate: reuploadDate.toISOString().split("T")[0],
        status: "Pending",
        rowId: script.rowId,
      });

      results.push({ rowId: script.rowId, action: "re-upload", views, retention, reason });
    } else {
      results.push({ rowId: script.rowId, action: "none", views, retention });
    }
  }

  return res.status(200).json({ ok: true, checkDate, channelAvgViews, results });
};
