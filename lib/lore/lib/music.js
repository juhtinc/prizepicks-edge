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
const DARK_TRAP = [
  "https://archive.org/download/don-t-care-dark-trap-beat-instrumental-2017-hard-rap-hiphop-freestyle-trap-type-beat-free-dl/ACTAVIS%20Dark%20Trap%20Beat%20Instrumental%202017%20_%20Hard%20Dope%20Rap%20Beat%20Freestyle%20Trap%20Type%20Beat%20_%20Free%20DL.mp3",
  "https://archive.org/download/don-t-care-dark-trap-beat-instrumental-2017-hard-rap-hiphop-freestyle-trap-type-beat-free-dl/187%20Trap%20Beat%20Instrumental%202018%20_%20Hard%20Dark%20Lit%20Sad%20Rap%20Hiphop%20Freestyle%20Trap%20Type%20Beats%20_%20Free%20DL.mp3",
  "https://archive.org/download/don-t-care-dark-trap-beat-instrumental-2017-hard-rap-hiphop-freestyle-trap-type-beat-free-dl/ALL%20NIGHT%20Smooth%20Trap%20Beat%20Instrumental%202017%20_%20R%26B%20Rap%20Hiphop%20Freestyle%20Trap%20Type%20Beat%20_%20Free%20DL.mp3",
];
const LOFI_PIANO = [
  "https://archive.org/download/free-sad-type-beat-you-hurt-me-emotional-rap-piano-instrumental-2022/Free%20Sad%20Type%20Beat%20-%20'You%20Hurt%20Me'%20-%20Emotional%20Rap%20Piano%20Instrumental%202022.mp3",
  "https://archive.org/download/dontcry-bcalm-times-we-had-full-album/(3)%20Bcalm%20_%20dontcry%20-%20nightwatch%20(F).mp3",
  "https://archive.org/download/dontcry-bcalm-times-we-had-full-album/(6)%20Bcalm%20_%20dontcry%20-%20raindrops%20(F).mp3",
];

const FREE_MUSIC_LIBRARY = {
  // High energy stories → dark trap
  epic:       DARK_TRAP,
  intense:    DARK_TRAP,
  hype:       DARK_TRAP,
  // Emotional/tragic stories → lo-fi piano
  nostalgic:  LOFI_PIANO,
  melancholy: LOFI_PIANO,
  inspiring:  LOFI_PIANO,
  // Mid-energy → dark trap (better default than generic cinematic)
  dramatic:   DARK_TRAP,
  mysterious: DARK_TRAP,
  dark:       DARK_TRAP,
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
