/**
 * api/lore/select-music.js  →  POST /api/lore/select-music
 * Feature #15: Select and generate background music for a video.
 * Tries Mubert API first, falls back to pre-built library.
 *
 * Body: { rowId }
 * Auth: x-secret header
 */

const { getMoodForStory, generateMubertTrack, selectFromLibrary } = require("./lib/music");
const { getScript, saveScript, getRecentlyUsedTracks, trackMusicUsage } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId } = req.body || {};
  if (!rowId) return res.status(400).json({ error: "rowId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  const mood = getMoodForStory(script.storyType, script.script);

  let music = await generateMubertTrack(mood);
  if (!music) {
    const recentlyUsed = await getRecentlyUsedTracks(7);
    music = selectFromLibrary(mood, recentlyUsed);
  }

  script.musicMood = mood.mood;
  script.musicTrack = music.trackUrl || music.trackName;
  script.musicSource = music.source;

  await saveScript(rowId, script);
  if (music.trackName) await trackMusicUsage(music.trackName);

  return res.status(200).json({ ok: true, rowId, mood, music });
};
