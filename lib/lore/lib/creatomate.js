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

function sanitizeText(text) {
  if (!text) return text;
  return text
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/ÃƒÆ'[^a-zA-Z]*|â‚¬[^a-zA-Z]*/g, " — ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function renderVideo({ voiceoverUrl, musicTrackUrl, clipUrls, textOverlays }) {
  // Build modifications matching the NBA Shorts Master v1 template element names
  const modifications = {};

  // Template uses {{variable}} placeholders — set all to prevent render errors
  // Default stock basketball footage when no clips available
  const DEFAULT_FOOTAGE = "https://videos.pexels.com/video-files/10341423/10341423-hd_720_1366_25fps.mp4";
  // Transparent 1x1 pixel for player photo placeholder
  const DEFAULT_PHOTO = "https://placehold.co/400x400/00000000/00000000.png";

  // All template {{variables}} must be set or Creatomate will fail
  modifications["footage_url"] = (clipUrls && clipUrls[0]) || DEFAULT_FOOTAGE;
  modifications["voiceover_mp3"] = voiceoverUrl || "";
  modifications["hook_text"] = sanitizeText(textOverlays?.hook_text || "");
  modifications["player_name"] = sanitizeText(textOverlays?.player_name || "");
  modifications["player_photo_url"] = textOverlays?.player_photo || DEFAULT_PHOTO;
  modifications["story_text"] = sanitizeText(textOverlays?.caption || "");
  modifications["stat_1"] = textOverlays?.stat_1 || "";
  modifications["stat_2"] = textOverlays?.stat_2 || "";
  modifications["stat_3"] = textOverlays?.stat_3 || "";

  const requestBody = {
    template_id: process.env.CREATOMATE_VIDEO_TEMPLATE_ID,
    modifications,
  };
  console.log("[creatomate] render request:", JSON.stringify(requestBody).slice(0, 500));

  const resp = await axios.post(`${BASE_URL}/renders`, requestBody, { headers: headers() }).catch(e => {
    const body = e.response?.data ? JSON.stringify(e.response.data) : "no body";
    throw new Error(`Creatomate ${e.response?.status}: ${body} | request: ${JSON.stringify(requestBody).slice(0, 300)}`);
  });
  const render = resp.data?.[0];

  // Poll until render is finished (up to 30 seconds to stay within 60s limit)
  if (render?.id && render.status !== "succeeded") {
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const status = await getRenderStatus(render.id);
      if (status.status === "succeeded") {
        return { renderId: status.id, url: status.url, status: status.status };
      }
      if (status.status === "failed") {
        throw new Error(`Render failed: ${status.error_message || "unknown"}`);
      }
    }
    // If still rendering, return the render ID so caller can check later
    return { renderId: render.id, url: null, status: "rendering" };
  }

  return { renderId: render?.id, url: render?.url, status: render?.status };
}

async function getRenderStatus(renderId) {
  const resp = await axios.get(`${BASE_URL}/renders/${renderId}`, { headers: headers() });
  return resp.data;
}

module.exports = { renderThumbnail, renderVideo, getRenderStatus };
