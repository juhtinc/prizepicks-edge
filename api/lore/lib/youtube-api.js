/**
 * api/lore/lib/youtube-api.js
 * YouTube Data API v3 + Analytics API client for Sports Lore.
 */

const axios = require("axios");

const YT_DATA_BASE = "https://www.googleapis.com/youtube/v3";
const YT_ANALYTICS_BASE = "https://youtubeanalytics.googleapis.com/v2";

async function getAccessToken() {
  if (process.env.YOUTUBE_ACCESS_TOKEN) return process.env.YOUTUBE_ACCESS_TOKEN;
  const resp = await axios.post("https://oauth2.googleapis.com/token", {
    client_id: process.env.YOUTUBE_CLIENT_ID,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET,
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  return resp.data.access_token;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function getVideoAnalytics(videoIds, startDate, endDate) {
  const token = await getAccessToken();
  const resp = await axios.get(`${YT_ANALYTICS_BASE}/reports`, {
    headers: authHeaders(token),
    params: {
      ids: "channel==MINE",
      metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained",
      dimensions: "video",
      filters: `video==${videoIds.join(",")}`,
      startDate,
      endDate,
    },
  });
  return resp.data;
}

async function getCommentThreads(videoId, maxResults = 20) {
  const token = await getAccessToken();
  const resp = await axios.get(`${YT_DATA_BASE}/commentThreads`, {
    headers: authHeaders(token),
    params: { part: "snippet", videoId, maxResults, order: "relevance" },
  });
  return resp.data.items || [];
}

async function replyToComment(parentId, text) {
  const token = await getAccessToken();
  const resp = await axios.post(`${YT_DATA_BASE}/comments`, {
    snippet: { parentId, textOriginal: text },
  }, {
    headers: authHeaders(token),
    params: { part: "snippet" },
  });
  return resp.data;
}

async function uploadVideo({ title, description, tags, videoBuffer, thumbnailBuffer, publishAt }) {
  const token = await getAccessToken();
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  const metadata = {
    snippet: { title, description, tags, channelId, categoryId: "17" },
    status: {
      privacyStatus: publishAt ? "private" : "public",
      publishAt: publishAt || undefined,
      selfDeclaredMadeForKids: false,
    },
  };
  const resp = await axios.post(
    `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`,
    metadata,
    { headers: { ...authHeaders(token), "Content-Type": "application/json" } }
  );
  return { videoId: resp.data?.id, uploadUrl: resp.headers?.location };
}

async function setThumbnail(videoId, thumbnailUrl) {
  const token = await getAccessToken();
  const imgResp = await axios.get(thumbnailUrl, { responseType: "arraybuffer" });
  await axios.post(
    `${YT_DATA_BASE}/thumbnails/set?videoId=${videoId}`,
    imgResp.data,
    { headers: { ...authHeaders(token), "Content-Type": "image/png" } }
  );
}

module.exports = {
  getAccessToken, getVideoAnalytics, getCommentThreads,
  replyToComment, uploadVideo, setThumbnail,
};
