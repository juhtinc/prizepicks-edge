/**
 * api/lore/lib/elevenlabs.js
 * ElevenLabs Text-to-Speech API client.
 */

const axios = require("axios");

const BASE_URL = "https://api.elevenlabs.io/v1";

async function generateVoiceover(text, voiceId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  const vid = voiceId || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

  const resp = await axios.post(
    `${BASE_URL}/text-to-speech/${vid}`,
    {
      text,
      model_id: "eleven_monolingual_v1",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    },
    {
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      responseType: "arraybuffer",
    }
  );

  const base64 = Buffer.from(resp.data).toString("base64");
  return `data:audio/mpeg;base64,${base64}`;
}

module.exports = { generateVoiceover };
