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

// Free royalty-free music from archive.org (direct MP3 URLs, no hotlink restrictions)
// Two styles: dark trap (atmospheric 808s) and lo-fi piano (emotional/cinematic)
// Cinematic underscore library — piano, strings, orchestral (no trap/beats)
// All 60+ seconds, hotlinkable, royalty-free. Scott Buckley = CC BY 4.0.
const MELANCHOLIC = [
  "https://archive.org/download/melancholy-ashamaluevmusic/05.%20Melancholy%20-%20AShamaluevMusic.mp3",
  "https://archive.org/download/memories-ashamaluevmusic/07.%20Memories%20-%20AShamaluevMusic.mp3",
  "https://archive.org/download/loneliness-ashamaluevmusic/04.%20Loneliness%20-%20AShamaluevMusic.mp3",
  "https://archive.org/download/memories-ashamaluevmusic/10.%20Sad%20Piano%20and%20Strings%20-%20AShamaluevMusic.mp3",
  "https://archive.org/download/sadpiano_202007/Far%20Light.mp3",
];
const CINEMATIC_BUILD = [
  "https://archive.org/download/soundcloud-436304418/Cinematic_Documentary_-_No_Copyright_Emotional_Background_Music_For_Videos_Films-436304418.mp3",
  "https://www.scottbuckley.com.au/library/wp-content/uploads/2024/06/AtTheEndOfAllThings.mp3",
  "https://www.scottbuckley.com.au/library/wp-content/uploads/2024/09/ShouldersOfGiants.mp3",
];
const DARK_SUSPENSE = [
  "https://archive.org/download/drama-ashamaluevmusic/01.%20Drama%20-%20AShamaluevMusic.mp3",
  "https://archive.org/download/memories-ashamaluevmusic/08.%20SAD%20-%20AShamaluevMusic.mp3",
  "https://www.scottbuckley.com.au/library/wp-content/uploads/2023/10/PhaseShift.mp3",
];
const HOPEFUL = [
  "https://archive.org/download/soundcloud-475163286/Serious_Documentary_-_No_Copyright_Emotional_and_Cinematic_Background_Music_For_Videos-475163286.mp3",
  "https://archive.org/download/memories-ashamaluevmusic/02.%20Soft%20Drama%20-%20AShamaluevMusic.mp3",
  "https://www.scottbuckley.com.au/library/wp-content/uploads/2025/03/Amberlight.mp3",
];

const FREE_MUSIC_LIBRARY = {
  // Tragic/forgotten stories → melancholic piano + strings
  nostalgic:  MELANCHOLIC,
  melancholy: MELANCHOLIC,
  // Record breakers / rising action → cinematic build
  epic:       CINEMATIC_BUILD,
  inspiring:  CINEMATIC_BUILD,
  // Scandal / controversy → dark suspense
  dark:       DARK_SUSPENSE,
  intense:    DARK_SUSPENSE,
  mysterious: DARK_SUSPENSE,
  // Comeback / redemption → hopeful bittersweet
  hype:       HOPEFUL,  // "hype" stories are actually comeback/triumph arcs
  // Default → melancholic (most stories are forgotten legends)
  dramatic:   MELANCHOLIC,
};

function selectFromLibrary(mood, recentlyUsed = []) {
  const tracks = FREE_MUSIC_LIBRARY[mood.mood] || FREE_MUSIC_LIBRARY.dramatic;
  const trackUrl = tracks[Math.floor(Math.random() * tracks.length)];
  return {
    trackUrl,
    trackName: mood.mood,
    source: "library",
  };
}

/**
 * Get dual-track moods for a story type using story template data.
 * Returns { primary, secondary, shiftTime } for two-mood emotional arc.
 */
function getDualTrackMoods(storyType) {
  // Import inline to avoid circular dependency
  const { getStoryTemplate } = require("./story-templates");
  const template = getStoryTemplate(storyType);

  return {
    primary: template.musicMoods?.primary || getMoodForStory(storyType).mood,
    secondary: template.musicMoods?.secondary || getMoodForStory(storyType).mood,
    shiftTime: template.musicShift?.time || 25,
  };
}

/**
 * Generate a music timeline with two tracks for emotional arc.
 * Track 1 plays from 0 to shiftTime, Track 2 from shiftTime to end.
 * Both have a 2-second crossfade at the transition.
 */
function generateMusicTimeline(storyType, duration = 55) {
  const { primary, secondary, shiftTime } = getDualTrackMoods(storyType);

  return {
    track1: {
      mood: primary,
      start: 3,  // Music starts after 3s hook (silent hook)
      end: shiftTime + 1,  // 1s overlap for crossfade
      fadeIn: 2,
      fadeOut: 1,
    },
    track2: {
      mood: secondary,
      start: shiftTime - 1,  // 1s overlap for crossfade
      end: duration,
      fadeIn: 1,
      fadeOut: 3,
    },
    shiftTime,
  };
}

module.exports = {
  MUSIC_MOOD_MAP, AUDIO_MIX,
  getMoodForStory, generateMubertTrack, selectFromLibrary,
  getDualTrackMoods, generateMusicTimeline,
};
