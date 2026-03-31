/**
 * api/lore/video-production.js  →  POST /api/lore/video-production
 * Full video production pipeline for a single script.
 */

const { generateVoiceover } = require("./lib/elevenlabs");
const { renderVideo, renderComposition } = require("./lib/creatomate");
const { composeVideo } = require("./lib/video-composer");
const { uploadVideo, setThumbnail, uploadCaptions, postComment, addToPlaylist } = require("./lib/youtube-api");
const { postToTikTok, postToInstagram } = require("./lib/cross-post");
const { generateSRTBuffer } = require("./lib/srt-generator");
const { getEasternOffset } = require("./lib/utils");
const { generateMusicTimeline } = require("./lib/music");
const { generateCaptions, captionsToCreatomate } = require("./lib/captions");
const { statOverlaysToCreatomate } = require("./lib/stat-overlays");
const { generateSFXPlacements } = require("./lib/sfx");
const { getStoryTemplate, calculateClipSlots } = require("./lib/story-templates");
const { getScript, saveScript, savePublished } = require("./lib/kv-lore");

function generateTimestamps(storyType) {
  const { getStoryTemplate } = require("./lib/story-templates");
  const template = getStoryTemplate(storyType);
  return template.segments
    .map(s => `${Math.floor(s.start / 60)}:${String(s.start % 60).padStart(2, "0")} ${s.name.charAt(0).toUpperCase() + s.name.slice(1)}`)
    .join("\n");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId, preview } = req.body || {};
  if (!rowId) return res.status(400).json({ error: "rowId required" });
  const previewMode = preview === true || req.query.preview === "1";

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

  log.steps.postTime = script.scheduledPostTime || "19:00";

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

  // Generate stat overlay modifications for Creatomate
  let statOverlayMods = {};
  try {
    if (script.statOverlays && script.statOverlays.length > 0) {
      statOverlayMods = statOverlaysToCreatomate(script.statOverlays);
      log.steps.statOverlays = `${script.statOverlays.length} stat overlays`;
    }
  } catch (e) {
    log.steps.statOverlays = "failed: " + e.message;
  }

  // Render video with dynamic composition (no template)
  let videoUrl = null;
  try {
    // Only pass URLs that are real (not placeholder/fake URLs)
    const voUrl = script.voiceoverUrl && !script.voiceoverUrl.startsWith("data:") ? script.voiceoverUrl : null;
    const musicUrl = script.musicTrack && script.musicTrack.includes("drive.google.com/sports-lore") ? null : script.musicTrack;

    // Build segment list from story template (text will be split by the composer)
    const storyTemplate = getStoryTemplate(script.storyType);
    const segments = storyTemplate.segments.map(seg => ({
      start: seg.start,
      end: seg.end,
      name: seg.name,
      text: "",  // composer will distribute script text across segments
      type: seg.clipCategory === "stats" || seg.name === "reveal" ? "reveal" : "footage",
    }));

    // Build the full Creatomate source JSON programmatically
    const source = await composeVideo({
      script,
      voiceoverUrl: voUrl,
      musicTrackUrl: musicUrl,
      segments,  // empty text = composer splits script.script automatically
    });

    log.steps.composition = `${source.elements.length} elements, ${source.duration}s`;

    // Send raw source to Creatomate (no template_id)
    const render = await renderComposition(source);
    videoUrl = render.url;
    script.renderUrl = videoUrl;
    script.renderId = render.renderId;
    if (render.status === "rendering") {
      log.steps.render = "rendering (check back later)";
      log.steps.renderId = render.renderId;
    } else {
      log.steps.render = videoUrl ? "ok (composed)" : "no URL returned";
      log.steps.renderUrl = videoUrl || null;
    }
  } catch (e) {
    log.steps.render = "failed: " + e.message;
  }

  // Save render URL to KV regardless of mode
  await saveScript(rowId, script);

  // In preview mode, stop here — return the video URL for manual review
  if (previewMode) {
    script.status = "Preview";
    await saveScript(rowId, script);
    return res.status(200).json({
      ok: true,
      preview: true,
      downloadUrl: videoUrl,
      title: script.titleUsed,
      description: script.description,
      hashtags: script.hashtags,
      log,
    });
  }

  if (videoUrl) {
    try {
      const publishAt = `${script.scheduledDate}T${script.scheduledPostTime}:00${getEasternOffset(new Date())}`;
      const upload = await uploadVideo({
        title: script.titleUsed,
        description: `${script.description}\n\n${(script.hashtags || []).join(" ")}\n\nTimestamps:\n${generateTimestamps(script.storyType)}`,
        tags: script.hashtags || [],
        videoBuffer: null,
        publishAt,
        madeWithAI: true,  // YouTube AI content disclosure
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

  // Step 6b: Upload SRT closed captions
  if (script.youtubeVideoId) {
    try {
      const voText = script.hookLine
        ? script.hookLine + ". " + script.script.replace(/^[^.!?]+[.!?]\s*/, "")
        : script.script;
      const srtBuffer = generateSRTBuffer(voText);
      await uploadCaptions(script.youtubeVideoId, srtBuffer);
      log.steps.captions_srt = "ok";
    } catch (e) {
      log.steps.captions_srt = "failed: " + e.message;
    }
  }

  // Step 6c: Post seeding comment (from the script's comment bait)
  if (script.youtubeVideoId) {
    try {
      const seedComment = script.commentBait
        || "What do you think? Drop your take below 👇";
      const commentResp = await postComment(script.youtubeVideoId, seedComment);
      log.steps.seeding_comment = commentResp?.id ? "ok" : "posted";
    } catch (e) {
      log.steps.seeding_comment = "failed: " + e.message;
    }
  }

  // Step 6d: Add to sport-specific playlist
  if (script.youtubeVideoId && process.env[`PLAYLIST_${script.playerSport}`]) {
    try {
      const playlistId = process.env[`PLAYLIST_${script.playerSport}`];
      await addToPlaylist(playlistId, script.youtubeVideoId);
      log.steps.playlist = `added to ${script.playerSport} playlist`;
    } catch (e) {
      log.steps.playlist = "failed: " + e.message;
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
