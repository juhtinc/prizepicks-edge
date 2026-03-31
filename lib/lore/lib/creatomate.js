/**
 * api/lore/lib/creatomate.js
 * Creatomate API client for video rendering and thumbnail generation.
 */

const axios = require("axios");

const BASE_URL = "https://api.creatomate.com/v1";

function headers() {
  return {
    Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function renderThumbnail({ playerName, hookText, playerImageUrl, accentColor }) {
  const resp = await axios.post(`${BASE_URL}/renders`, {
    template_id: process.env.CREATOMATE_THUMBNAIL_TEMPLATE_ID,
    modifications: {
      player_name: playerName,
      hook_text: (hookText || "").slice(0, 30),
      player_image: playerImageUrl,
      accent_color: accentColor || "#FF4444",
    },
  }, { headers: headers() });
  const render = resp.data?.[0];
  return { renderId: render?.id, url: render?.url, status: render?.status };
}

async function renderVideo({ voiceoverUrl, musicTrackUrl, clipUrls, textOverlays }) {
  // Map clip URLs to clip_1 through clip_18 slots in the template
  const clipModifications = {};
  (clipUrls || []).forEach((url, i) => {
    if (url) clipModifications[`clip_${i + 1}`] = url;
  });

  const resp = await axios.post(`${BASE_URL}/renders`, {
    template_id: process.env.CREATOMATE_VIDEO_TEMPLATE_ID,
    modifications: {
      voiceover: voiceoverUrl,
      background_music: musicTrackUrl,
      ...clipModifications,
      ...textOverlays,
    },
  }, { headers: headers() });
  const render = resp.data?.[0];
  return { renderId: render?.id, url: render?.url, status: render?.status };
}

async function getRenderStatus(renderId) {
  const resp = await axios.get(`${BASE_URL}/renders/${renderId}`, { headers: headers() });
  return resp.data;
}

module.exports = { renderThumbnail, renderVideo, getRenderStatus };
