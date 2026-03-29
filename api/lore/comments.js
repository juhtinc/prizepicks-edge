/**
 * api/lore/comments.js  →  POST /api/lore/comments
 * Feature #11: Monitor comments on recent videos, score them, suggest replies.
 */

const { askClaudeJSON } = require("./lib/claude");
const { getCommentThreads } = require("./lib/youtube-api");
const { getBatchScripts } = require("./lib/kv-lore");
const { getISOWeek } = require("./lib/utils");

module.exports = async function handler(req, res) {
  const secret = req.headers["x-secret"] || req.query.secret;
  const authHeader = req.headers.authorization;
  const expected = process.env.CRON_SECRET;
  if (secret !== expected && authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const weekNum = getISOWeek(now);
  const batchId = `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  const scripts = await getBatchScripts(batchId);

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
