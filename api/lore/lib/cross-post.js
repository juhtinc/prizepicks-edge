/**
 * api/lore/lib/cross-post.js
 * TikTok Content Posting API + Instagram Graph API clients.
 */

const axios = require("axios");

const PLATFORM_HASHTAGS = {
  youtube:   "#shorts #nba #basketball #sportshistory",
  tiktok:    "#fyp #foryou #nba #basketball #sportsfact #didyouknow",
  instagram: "#reels #nba #basketball #sportshistory #explore",
};

async function postToTikTok({ title, description, videoUrl }) {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token) return { ok: false, error: "TikTok not configured" };

  const resp = await axios.post(
    "https://open.tiktokapis.com/v2/post/publish/video/init/",
    {
      post_info: {
        title,
        description: `${description} ${PLATFORM_HASHTAGS.tiktok}`,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: videoUrl,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  return { ok: true, publishId: resp.data?.data?.publish_id };
}

async function postToInstagram({ description, videoUrl }) {
  const userId = process.env.INSTAGRAM_USER_ID;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!userId || !token) return { ok: false, error: "Instagram not configured" };

  const createResp = await axios.post(
    `https://graph.facebook.com/v19.0/${userId}/media`,
    null,
    {
      params: {
        media_type: "REELS",
        video_url: videoUrl,
        caption: `${description} ${PLATFORM_HASHTAGS.instagram}`,
        access_token: token,
      },
    }
  );

  const containerId = createResp.data?.id;
  if (!containerId) return { ok: false, error: "Failed to create IG container" };

  await new Promise(resolve => setTimeout(resolve, 30000));

  const publishResp = await axios.post(
    `https://graph.facebook.com/v19.0/${userId}/media_publish`,
    null,
    { params: { creation_id: containerId, access_token: token } }
  );

  return { ok: true, mediaId: publishResp.data?.id };
}

module.exports = { postToTikTok, postToInstagram, PLATFORM_HASHTAGS };
