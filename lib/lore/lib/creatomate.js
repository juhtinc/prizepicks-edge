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
  }, { headers: headers() }).catch(e => {
    const body = e.response?.data ? JSON.stringify(e.response.data) : "no body";
    throw new Error(`Creatomate ${e.response?.status}: ${body}`);
  });
  const render = resp.data?.[0];

  // Poll until render is finished (up to 45 seconds)
  if (render?.id && render.status !== "succeeded") {
    for (let i = 0; i < 9; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const status = await getRenderStatus(render.id);
      if (status.status === "succeeded") {
        return { renderId: status.id, url: status.url, status: status.status };
      }
      if (status.status === "failed") {
        throw new Error(`Render failed: ${status.error_message || "unknown"}`);
      }
    }
  }

  return { renderId: render?.id, url: render?.url, status: render?.status };
}

async function getRenderStatus(renderId) {
  const resp = await axios.get(`${BASE_URL}/renders/${renderId}`, { headers: headers() });
  return resp.data;
}

module.exports = { renderThumbnail, renderVideo, getRenderStatus };
