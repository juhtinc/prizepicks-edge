/**
 * api/lore/video-production.js  →  POST /api/lore/video-production
 * Full video production pipeline for a single script.
 */

const { generateVoiceover } = require("./lib/elevenlabs");
const { renderVideo } = require("./lib/creatomate");
const { uploadVideo, setThumbnail } = require("./lib/youtube-api");
const { postToTikTok, postToInstagram } = require("./lib/cross-post");
const { getOptimalPostTime } = require("./lib/post-times");
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

  let videoUrl = null;
  try {
    const render = await renderVideo({
      voiceoverUrl: script.voiceoverUrl,
      musicTrackUrl: script.musicTrack,
      clipUrls: (script.clipBriefs || []).map(c => c.pexelsUrl).filter(Boolean),
      textOverlays: { hook_text: script.hookLine, player_name: script.playerName },
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
