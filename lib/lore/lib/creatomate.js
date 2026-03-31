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
  // Build modifications matching the NBA Shorts Master v1 template element names
  const modifications = {};

  // Audio layers
  if (voiceoverUrl) modifications["Voiceover"] = voiceoverUrl;
  if (musicTrackUrl) modifications["Background Music"] = musicTrackUrl;

  // Background footage (first clip if available)
  if (clipUrls && clipUrls[0]) modifications["Background Footage"] = clipUrls[0];

  // Text overlays — map to template element names
  if (textOverlays?.hook_text) modifications["Hook Text"] = textOverlays.hook_text;
  if (textOverlays?.player_name) modifications["Player Name"] = textOverlays.player_name;
  if (textOverlays?.player_photo) modifications["Player Photo"] = textOverlays.player_photo;
  if (textOverlays?.caption) modifications["Story Caption"] = textOverlays.caption;

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
