/**
 * api/lore/lib/music.js
 * Music mood mapping and selection logic for Sports Lore videos.
 * Maps story types → mood/energy/tempo/genre for background music.
 */

const MUSIC_MOOD_MAP = {
  forgotten_legend:  { mood: "nostalgic",  energy: "medium", tempo: "slow",   genre: "cinematic" },
  trending_callback: { mood: "hype",       energy: "high",   tempo: "fast",   genre: "trap" },
  what_if:           { mood: "mysterious",  energy: "medium", tempo: "medium", genre: "ambient" },
  rivalry:           { mood: "intense",     energy: "high",   tempo: "fast",   genre: "orchestral" },
  record_breaker:    { mood: "epic",        energy: "high",   tempo: "medium", genre: "cinematic" },
  comeback:          { mood: "inspiring",   energy: "rising", tempo: "builds", genre: "orchestral" },
  scandal:           { mood: "dark",        energy: "medium", tempo: "slow",   genre: "dark_ambient" },
  draft_bust:        { mood: "melancholy",  energy: "low",    tempo: "slow",   genre: "piano" },
  underdog:          { mood: "inspiring",   energy: "rising", tempo: "builds", genre: "cinematic" },
  goat_debate:       { mood: "intense",     energy: "high",   tempo: "fast",   genre: "trap" },
  default:           { mood: "dramatic",    energy: "medium", tempo: "medium", genre: "cinematic" },
};

const AUDIO_MIX = {
  hook:   { start: 0,  end: 3,  musicVolume: 0 },
  build:  { start: 3,  end: 15, musicVolume: 20 },
  body:   { start: 15, end: 40, musicVolume: 25 },
  climax: { start: 40, end: 48, musicVolume: 40 },
  outro:  { start: 48, end: 55, musicVolume: 50 },
};

function getMoodForStory(storyType, scriptText = "") {
  const base = { ...(MUSIC_MOOD_MAP[storyType] || MUSIC_MOOD_MAP.default) };
  const lower = scriptText.toLowerCase();

  if (lower.includes("tragic") || lower.includes("died") || lower.includes("career-ending")) {
    base.mood = "melancholy";
    base.energy = "low";
    base.genre = "piano";
  }
  if (lower.includes("championship") || lower.includes("record") || lower.includes("greatest")) {
    base.mood = "epic";
    base.energy = "high";
    base.genre = "orchestral";
  }

  return base;
}

async function generateMubertTrack(mood, duration = 55) {
  const pat = process.env.MUBERT_PAT;
  if (!pat) return null;

  const axios = require("axios");
  const resp = await axios.post("https://api.mubert.com/v2/RecordTrackTTM", {
    method: "RecordTrackTTM",
    params: {
      pat,
      duration,
      tags: [mood.genre, mood.mood, "sports"],
      mode: "track",
      intensity: mood.energy,
    },
  });

  const trackUrl = resp.data?.data?.tasks?.[0]?.download_link;
  if (!trackUrl) return null;
  return { trackUrl, source: "mubert" };
}

function selectFromLibrary(mood, recentlyUsed = []) {
  const trackName = `${mood.mood}_01.mp3`;
  return {
    trackUrl: `https://drive.google.com/sports-lore/music/${mood.mood}/${trackName}`,
    trackName,
    source: "library",
  };
}

module.exports = {
  MUSIC_MOOD_MAP, AUDIO_MIX,
  getMoodForStory, generateMubertTrack, selectFromLibrary,
};
