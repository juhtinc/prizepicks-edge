/**
 * api/lore/render-fallback.js  →  POST /api/lore/render-fallback
 * Feature #13: FFmpeg fallback when Creatomate is down.
 * Returns FFmpeg command for external execution on Vercel (can't run FFmpeg directly).
 */

const { renderVideo } = require("./lib/creatomate");
const { getScript } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId } = req.body || {};
  if (!rowId) return res.status(400).json({ error: "rowId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  let render = null;
  if (process.env.CREATOMATE_API_KEY) {
    try {
      render = await renderVideo({
        voiceoverUrl: script.voiceoverUrl,
        musicTrackUrl: script.musicTrack,
        clipUrls: (script.clipBriefs || []).map(c => c.pexelsUrl).filter(Boolean),
        textOverlays: { hook_text: script.hookLine, player_name: script.playerName },
      });
    } catch (e) {
      console.error("[render] Creatomate attempt 1 failed:", e.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
      try {
        render = await renderVideo({
          voiceoverUrl: script.voiceoverUrl,
          musicTrackUrl: script.musicTrack,
          clipUrls: (script.clipBriefs || []).map(c => c.pexelsUrl).filter(Boolean),
          textOverlays: { hook_text: script.hookLine, player_name: script.playerName },
        });
      } catch (e2) {
        console.error("[render] Creatomate attempt 2 failed:", e2.message);
      }
    }
  }

  if (render && render.url) {
    return res.status(200).json({ ok: true, rowId, source: "creatomate", videoUrl: render.url });
  }

  const ffmpegCommand = [
    "ffmpeg",
    "-loop", "1",
    "-i", `"${script.playerPhotoUrl}"`,
    "-i", `"${script.voiceoverUrl || "voiceover.mp3"}"`,
    script.musicTrack ? `-i "${script.musicTrack}"` : "",
    "-vf", `"drawtext=text='${(script.hookLine || "").replace(/'/g, "\\'")}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=h-200"`,
    "-c:v", "libx264",
    "-tune", "stillimage",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-pix_fmt", "yuv420p",
    `"output_${rowId}.mp4"`,
  ].filter(Boolean).join(" ");

  return res.status(200).json({
    ok: true,
    rowId,
    source: "ffmpeg_fallback",
    warning: "Creatomate was unavailable. FFmpeg command generated for external execution.",
    ffmpegCommand,
  });
};
