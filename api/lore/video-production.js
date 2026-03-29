/**
 * api/lore/video-production.js  →  POST /api/lore/video-production
 * Full video production pipeline for a single script.
 */

const { generateVoiceover } = require("./lib/elevenlabs");
const { renderVideo } = require("./lib/creatomate");
const { uploadVideo, setThumbnail } = require("./lib/youtube-api");
const { postToTikTok, postToInstagram } = require("./lib/cross-post");
const { getOptimalPostTime } = require("./lib/post-times");
const { generateMusicTimeline } = require("./lib/music");
const { generateCaptions, captionsToCreatomate } = require("./lib/captions");
const { generateSFXPlacements } = require("./lib/sfx");
const { getStoryTemplate, calculateClipSlots } = require("./lib/story-templates");
const { getScript, saveScript, savePublished } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId } = req.body || {};
  if (!rowId) return res.status(400).json({ error: "rowId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  const log = { rowId, steps: {} };

  const voiceoverText = script.hookLine
    ? script.hookLine + ". " + script.script.replace(/^[^.!?]+[.!?]\s*/, "")
    : script.script;

  try {
    script.voiceoverUrl = await generateVoiceover(voiceoverText);
    log.steps.voiceover = script.voiceoverUrl ? "ok" : "skipped (no API key)";
  } catch (e) {
    log.steps.voiceover = "failed: " + e.message;
  }

  const useB = new Date().getDay() % 2 === 0;
  script.titleUsed = useB ? (script.titleB || script.titleA) : script.titleA;
  script.titleVersion = useB ? "B" : "A";
  log.steps.title = `Using title ${script.titleVersion}: "${script.titleUsed}"`;

  script.scheduledPostTime = getOptimalPostTime(script.playerSport);
  log.steps.postTime = script.scheduledPostTime;

  // Generate captions (word-by-word with emphasis highlighting)
  let captionData = [];
  try {
    const captions = generateCaptions(voiceoverText);
    captionData = captionsToCreatomate(captions);
    log.steps.captions = `${captionData.length} caption groups generated`;
  } catch (e) {
    log.steps.captions = "failed: " + e.message;
  }

  // Generate dual-track music timeline
  let musicTimeline = null;
  try {
    musicTimeline = generateMusicTimeline(script.storyType);
    log.steps.musicTimeline = `Shift at ${musicTimeline.shiftTime}s: ${musicTimeline.track1.mood} → ${musicTimeline.track2.mood}`;
  } catch (e) {
    log.steps.musicTimeline = "failed: " + e.message;
  }

  // Generate SFX placements
  let sfxPlacements = [];
  try {
    const template = getStoryTemplate(script.storyType);
    const clipSlots = calculateClipSlots(script.storyType);
    sfxPlacements = generateSFXPlacements(template, clipSlots, script.script);
    log.steps.sfx = `${sfxPlacements.length} SFX placed`;
  } catch (e) {
    log.steps.sfx = "failed: " + e.message;
  }

  // Render video with all layers
  let videoUrl = null;
  try {
    // Clip URLs sorted by slot order (timeline-synced to script)
    const sortedClips = (script.clipBriefs || [])
      .sort((a, b) => (a.slot || 0) - (b.slot || 0))
      .map(c => c.pexelsUrl)
      .filter(Boolean);

    const render = await renderVideo({
      voiceoverUrl: script.voiceoverUrl,
      musicTrackUrl: script.musicTrack,
      clipUrls: sortedClips,
      textOverlays: {
        hook_text: script.hookLine,
        player_name: script.playerName,
        // Pass caption and SFX data for Creatomate to render
        ...(captionData.length > 0 && { _captions: JSON.stringify(captionData) }),
        ...(sfxPlacements.length > 0 && { _sfx: JSON.stringify(sfxPlacements) }),
        ...(musicTimeline && { _music_timeline: JSON.stringify(musicTimeline) }),
      },
    });
    videoUrl = render.url;
    log.steps.render = videoUrl ? "ok" : "no URL returned";
  } catch (e) {
    log.steps.render = "failed: " + e.message;
  }

  if (videoUrl) {
    try {
      const publishAt = `${script.scheduledDate}T${script.scheduledPostTime}:00-05:00`;
      const upload = await uploadVideo({
        title: script.titleUsed,
        description: `${script.description}\n\n${(script.hashtags || []).join(" ")}`,
        tags: script.hashtags || [],
        videoBuffer: null,
        publishAt,
      });
      script.youtubeVideoId = upload.videoId;
      script.youtubeUrl = `https://youtube.com/shorts/${upload.videoId}`;
      log.steps.youtube = script.youtubeUrl || "upload initiated";
    } catch (e) {
      log.steps.youtube = "failed: " + e.message;
    }
  }

  if (script.youtubeVideoId && script.thumbnailUrl) {
    try {
      await setThumbnail(script.youtubeVideoId, script.thumbnailUrl);
      log.steps.thumbnail = "ok";
    } catch (e) {
      log.steps.thumbnail = "failed: " + e.message;
    }
  }

  if (videoUrl) {
    try {
      const tiktok = await postToTikTok({ title: script.titleUsed, description: script.description, videoUrl });
      log.steps.tiktok = tiktok.ok ? "ok" : tiktok.error;
    } catch (e) {
      log.steps.tiktok = "failed: " + e.message;
    }

    try {
      const ig = await postToInstagram({ description: script.description, videoUrl });
      log.steps.instagram = ig.ok ? "ok" : ig.error;
    } catch (e) {
      log.steps.instagram = "failed: " + e.message;
    }
  }

  script.status = "Produced";
  await saveScript(rowId, script);

  if (script.youtubeVideoId) {
    await savePublished(script.youtubeVideoId, {
      videoId: script.youtubeVideoId,
      rowId: script.rowId,
      title: script.titleUsed,
      titleVersion: script.titleVersion,
      playerName: script.playerName,
      storyType: script.storyType,
      publishedAt: new Date().toISOString(),
      youtubeUrl: script.youtubeUrl,
      tiktokUrl: script.tiktokUrl,
      instagramUrl: script.instagramUrl,
    });
  }

  return res.status(200).json({ ok: true, log });
};
