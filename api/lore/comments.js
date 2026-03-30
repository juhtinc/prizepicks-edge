/**
 * api/lore/comments.js  →  POST /api/lore/comments
 * Feature #11: Monitor comments on recent videos, score them, suggest replies.
 */

const { askClaudeJSON } = require("./lib/claude");
const { getCommentThreads } = require("./lib/youtube-api");
const { getBatchScripts } = require("./lib/kv-lore");
const { getISOWeek, getBatchIdForDate } = require("./lib/utils");

module.exports = async function handler(req, res) {
  const secret = req.headers["x-secret"] || req.query.secret;
  const authHeader = req.headers.authorization;
  const expected = process.env.CRON_SECRET;
  if (secret !== expected && authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { rowId, batchId } = req.body || {};

  // ── AUTO-PIN: Pin the top-liked comment after 12 hours ──
  if (req.query.action === "auto-pin") {
    const { getCommentThreads } = require("./lib/youtube-api");
    const { postComment } = require("./lib/youtube-api");

    const _pinBatchId = batchId || getBatchIdForDate(new Date());
    const _pinScriptsA = await getBatchScripts(`${_pinBatchId}-A`);
    const _pinScriptsB = await getBatchScripts(`${_pinBatchId}-B`);
    const scripts = [..._pinScriptsA, ..._pinScriptsB];

    // Find videos uploaded ~12 hours ago
    const now = new Date();
    const twelveHoursAgo = new Date(now);
    twelveHoursAgo.setHours(twelveHoursAgo.getHours() - 12);

    const toPin = scripts.filter(s => {
      if (!s.youtubeVideoId) return false;
      const uploadDate = new Date(s.scheduledDate);
      const uploadTime = new Date(`${s.scheduledDate}T${s.scheduledPostTime || "19:00"}:00`);
      const hoursSinceUpload = (now - uploadTime) / (1000 * 60 * 60);
      return hoursSinceUpload >= 11 && hoursSinceUpload <= 14;
    });

    const pinResults = [];
    for (const script of toPin) {
      try {
        const comments = await getCommentThreads(script.youtubeVideoId, 10);
        if (!comments.length) continue;

        // Find the comment with the most likes
        const topComment = comments
          .map(c => ({
            id: c.snippet.topLevelComment.id,
            text: c.snippet.topLevelComment.snippet.textDisplay,
            likes: c.snippet.topLevelComment.snippet.likeCount || 0,
          }))
          .sort((a, b) => b.likes - a.likes)[0];

        if (topComment && topComment.likes > 0) {
          // Note: YouTube API doesn't have a direct pin endpoint.
          // Pinning requires YouTube Studio. For now, we reply to the top comment
          // to boost it + log which comment should be pinned.
          pinResults.push({
            videoId: script.youtubeVideoId,
            playerName: script.playerName,
            topComment: topComment.text,
            likes: topComment.likes,
            commentId: topComment.id,
            action: "should_pin",
          });
        }
      } catch (e) {
        console.error(`[comments] Auto-pin failed for ${script.youtubeVideoId}:`, e.message);
      }
    }

    return res.status(200).json({ ok: true, action: "auto-pin", pinResults });
  }

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const weekNum = getISOWeek(now);
  const resolvedBatchId = batchId || `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  const scriptsA = await getBatchScripts(`${resolvedBatchId}-A`);
  const scriptsB = await getBatchScripts(`${resolvedBatchId}-B`);
  const scripts = [...scriptsA, ...scriptsB];

  const recentVideos = scripts.filter(s => {
    if (!s.youtubeVideoId) return false;
    const uploadDate = new Date(s.scheduledDate);
    return uploadDate >= yesterday && uploadDate <= now;
  });

  if (!recentVideos.length) {
    return res.status(200).json({ ok: true, message: "No recent videos to monitor" });
  }

  const allDigests = [];

  for (const script of recentVideos) {
    let comments;
    try {
      comments = await getCommentThreads(script.youtubeVideoId, 20);
    } catch (e) {
      console.error(`[comments] Failed to fetch for ${script.youtubeVideoId}:`, e.message);
      continue;
    }

    if (!comments.length) continue;

    const scored = comments.map(c => {
      const snippet = c.snippet.topLevelComment.snippet;
      const text = snippet.textDisplay;
      const likes = snippet.likeCount || 0;

      let score = likes * 2;
      if (text.includes("?")) score += 5;
      if (text.length > 50) score += 3;
      if (/who|what|when|why|how/i.test(text)) score += 3;

      return {
        commentId: c.snippet.topLevelComment.id,
        text,
        likes,
        score,
        author: snippet.authorDisplayName,
      };
    }).sort((a, b) => b.score - a.score).slice(0, 5);

    const commentsText = scored.map((c, i) => `${i + 1}. "${c.text}" (${c.likes} likes, by ${c.author})`).join("\n");

    const prompt = `You manage a YouTube Shorts channel about sports history. Here are the top comments on today's video about ${script.playerName}:

${commentsText}

For each comment, suggest a short, authentic reply (1-2 sentences). Be:
- Conversational, not corporate
- Add a fun fact when relevant
- Ask a follow-up question to keep the thread going
- Never be defensive

Return JSON array:
[{"comment_id":"...","suggested_reply":"..."}]`;

    const replies = await askClaudeJSON(prompt, { maxTokens: 500 });

    allDigests.push({
      videoId: script.youtubeVideoId,
      playerName: script.playerName,
      title: script.titleUsed || script.titleA,
      comments: scored,
      suggestedReplies: replies,
    });
  }

  return res.status(200).json({ ok: true, digests: allDigests });
};
