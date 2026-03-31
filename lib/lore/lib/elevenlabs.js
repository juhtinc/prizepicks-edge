/**
 * api/lore/lib/elevenlabs.js
 * ElevenLabs Text-to-Speech API client — optimized for sports storytelling.
 *
 * Key improvements over default config:
 *   - Uses eleven_multilingual_v2 (much more natural than v1)
 *   - SSML support for dramatic pacing (pauses before reveals)
 *   - Voice settings tuned for storytelling energy
 *   - Audio post-processing: compression + high-pass + subtle room reverb
 *
 * Env vars: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID
 */

const axios = require("axios");

const BASE_URL = "https://api.elevenlabs.io/v1";

/**
 * Insert SSML pacing into a script for dramatic storytelling.
 * Adds pauses before key moments and adjusts pacing per section.
 *
 * @param {string} text - Plain script text
 * @param {object} options - { retentionHookTimes, revealWords }
 * @returns {string} SSML-enhanced text
 */
function addSSMLPacing(text, options = {}) {
  let ssml = text;

  // Add medium pause before sentences that start with dramatic words
  const dramaticOpeners = /(?<=[.!?]\s)(But |And then |No one |Nobody |Never |However |That's when |Imagine |Unfortunately )/g;
  ssml = ssml.replace(dramaticOpeners, '<break time="400ms"/>$1');

  // Add short pause before numbers and stats (gives them weight)
  ssml = ssml.replace(/(\b\d{2,}[\d,.]*\b)/g, '<break time="200ms"/>$1');

  // Add pause before key reveal words
  const revealWords = options.revealWords || [
    "banned", "blacklisted", "fired", "traded", "retired", "died",
    "record", "greatest", "impossible", "never", "championship",
    "Hall of Fame", "MVP", "All-Star",
  ];
  for (const word of revealWords) {
    const regex = new RegExp(`(\\b${word}\\b)`, "gi");
    ssml = ssml.replace(regex, '<break time="300ms"/><prosody rate="90%">$1</prosody>');
  }

  // Slow down the final sentence (the kicker)
  const sentences = ssml.split(/(?<=[.!?])\s+/);
  if (sentences.length > 1) {
    sentences[sentences.length - 1] = `<prosody rate="85%">${sentences[sentences.length - 1]}</prosody>`;
    ssml = sentences.join(" ");
  }

  // Wrap in SSML speak tags
  return `<speak>${ssml}</speak>`;
}

/**
 * Generate voiceover audio from script text with storytelling optimization.
 *
 * @param {string} text - Script text (plain or pre-SSML)
 * @param {object} options - { voiceId, addPacing, retentionHookTimes }
 * @returns {string|null} Base64 data URL of audio, or null if no API key
 */
async function generateVoiceover(text, options = {}) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  const voiceId = options.voiceId || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

  // Sanitize: remove surrogate pairs and mojibake, normalize dashes/quotes
  const processedText = text
    .replace(/[\uD800-\uDFFF]/g, "")                    // remove surrogates
    .replace(/ÃƒÆ'[^a-zA-Z]*|â‚¬[^a-zA-Z]*/g, " — ")   // fix mojibake em dashes
    .replace(/\s{2,}/g, " ")                             // collapse extra spaces
    .trim();

  let resp;
  try {
    resp = await axios.post(
      `${BASE_URL}/text-to-speech/${voiceId}`,
      {
        text: processedText,
        model_id: modelId,
        voice_settings: {
          stability: 0.65,
          similarity_boost: 0.55,
          style: 0.3,
          use_speaker_boost: true,
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
  } catch (e) {
    // Surface the actual error body from ElevenLabs
    const body = e.response?.data ? Buffer.from(e.response.data).toString("utf8") : "no body";
    throw new Error(`ElevenLabs ${e.response?.status}: ${body}`);
  }

  // Upload to Vercel Blob for a publicly accessible URL
  const { put } = require("@vercel/blob");
  const filename = `lore-voiceover-${Date.now()}.mp3`;
  const blob = await put(filename, Buffer.from(resp.data), {
    access: "public",
    contentType: "audio/mpeg",
  });
  return blob.url;
}

/**
 * Generate FFmpeg filter chain for voiceover audio post-processing.
 * Returns the filter string to be applied before sending to Creatomate.
 *
 * Processing chain:
 *   1. High-pass at 80Hz (removes rumble/room noise)
 *   2. Compression (3:1 ratio, evens out loud/soft)
 *   3. Subtle room reverb (0.1s, 8% wet — adds warmth without echo)
 */
function getAudioPostProcessingFilter() {
  return "highpass=f=80,acompressor=threshold=-18dB:ratio=3:attack=5:release=50,aecho=0.8:0.88:6:0.08";
}

module.exports = { generateVoiceover, addSSMLPacing, getAudioPostProcessingFilter };
