/**
 * VPS FFmpeg Video Renderer
 * Composes a 1080x1920 YouTube Short from clips, voiceover, music, and captions.
 * Called from the main VPS server as a child process.
 *
 * Input: JSON via stdin with { clips, voiceoverUrl, musicUrl, captions, playerName, duration, outroStart }
 * Output: JSON with { ok, path } on success
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const WIDTH = 1080;
const HEIGHT = 1920;

const input = JSON.parse(fs.readFileSync("/dev/stdin", "utf8"));
const {
  clips, // [{url, start, duration}, ...] — 18 clips with timing
  voiceoverUrl, // URL to voiceover MP3/M4A
  musicUrl, // URL to background music (optional)
  captions, // [{text, start, duration, color}, ...] — caption groups
  playerName, // "MANUTE BOL"
  duration, // total video duration in seconds
  outroStart, // when outro card begins (seconds), or null
  outputPath, // where to save the final MP4
} = input;

const workDir = "/tmp/render-" + Date.now();
fs.mkdirSync(workDir, { recursive: true });

function dl(url, filename) {
  const out = path.join(workDir, filename);
  if (fs.existsSync(out)) return out;
  execSync(`curl -sL -o "${out}" "${url}"`, { timeout: 30000, stdio: "pipe" });
  return out;
}

function escape(text) {
  // Escape text for FFmpeg drawtext filter
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\''")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/%/g, "%%");
}

try {
  console.error("Downloading clips...");

  // Download all unique clip URLs
  const clipPaths = [];
  const downloaded = {};
  for (let i = 0; i < clips.length; i++) {
    const url = clips[i].url;
    if (!downloaded[url]) {
      downloaded[url] = dl(url, `clip_${i}.mp4`);
    }
    clipPaths.push(downloaded[url]);
  }

  // Download voiceover
  let voPath = null;
  if (voiceoverUrl) {
    console.error("Downloading voiceover...");
    voPath = dl(voiceoverUrl, "voiceover.mp3");
  }

  // Download music
  let musicPath = null;
  if (musicUrl) {
    console.error("Downloading music...");
    musicPath = dl(musicUrl, "music.mp3");
  }

  // Step 1: Create a concat file for clips — each scaled to 1080x1920
  console.error("Processing clips...");
  const processedClips = [];
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const processedPath = path.join(workDir, `processed_${i}.mp4`);
    const clipDur = clip.duration;

    // Check if this clip is covered by the outro
    const isOutro = outroStart && clip.start >= outroStart;

    if (isOutro) {
      // Generate black frame for outro duration
      execSync(
        `ffmpeg -y -f lavfi -i color=c=black:s=${WIDTH}x${HEIGHT}:d=${clipDur}:r=30 ` +
          `-c:v libx264 -preset ultrafast -tune stillimage -pix_fmt yuv420p "${processedPath}"`,
        { timeout: 30000, stdio: "pipe" },
      );
    } else {
      // Scale clip to 1080x1920 with cover fit + slight desaturation + Ken Burns zoom
      execSync(
        `ffmpeg -y -i "${clipPaths[i]}" -t ${clipDur} ` +
          `-vf "scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},` +
          `eq=saturation=0.85:contrast=1.1,` +
          `zoompan=z='min(zoom+0.0008,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(clipDur * 30)}:s=${WIDTH}x${HEIGHT}:fps=30" ` +
          `-c:v libx264 -preset fast -crf 23 -r 30 -pix_fmt yuv420p -an "${processedPath}"`,
        { timeout: 60000, stdio: "pipe" },
      );
    }
    processedClips.push(processedPath);
  }

  // Step 2: Concatenate all clips
  console.error("Concatenating clips...");
  const concatFile = path.join(workDir, "concat.txt");
  fs.writeFileSync(
    concatFile,
    processedClips.map((p) => `file '${p}'`).join("\n"),
  );
  const rawVideoPath = path.join(workDir, "raw_video.mp4");
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c copy "${rawVideoPath}"`,
    { timeout: 120000, stdio: "pipe" },
  );

  // Step 3: Build caption overlay filter
  console.error("Adding captions and overlays...");
  const fontFile = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  const hasFont = fs.existsSync(fontFile);
  const font = hasFont ? `fontfile=${fontFile}:` : "";

  let drawtextFilters = [];

  // Add captions
  if (captions && captions.length > 0) {
    for (const cap of captions) {
      const color = cap.color || "white";
      const text = escape(cap.text);
      const startT = cap.start;
      const endT = cap.start + cap.duration;
      drawtextFilters.push(
        `drawtext=${font}text='${text}':fontsize=42:fontcolor=${color}:` +
          `borderw=4:bordercolor=black:` +
          `x=(w-text_w)/2:y=h*0.40:` +
          `enable='between(t,${startT.toFixed(2)},${endT.toFixed(2)})'`,
      );
    }
  }

  // Add outro elements if outroStart is set
  if (outroStart && playerName) {
    const outroEnd = duration;
    // Player name in gold at top
    drawtextFilters.push(
      `drawtext=${font}text='${escape(playerName.toUpperCase())}':fontsize=64:fontcolor=0xD4920F:` +
        `borderw=3:bordercolor=black:` +
        `x=(w-text_w)/2:y=h*0.25:` +
        `enable='between(t,${outroStart.toFixed(2)},${outroEnd.toFixed(2)})'`,
    );
    // SPORTS LORE wordmark
    drawtextFilters.push(
      `drawtext=${font}text='SPORTS LORE':fontsize=22:fontcolor=0xD4920F@0.45:` +
        `x=(w-text_w)/2:y=h*0.62:` +
        `enable='between(t,${(outroStart + 1).toFixed(2)},${outroEnd.toFixed(2)})'`,
    );
  }

  // Add vignette
  const vignetteFilter = "vignette=PI/4";

  // Add progress bar at bottom
  const progressFilter = `drawbox=x=0:y=h-6:w=iw*(t/${duration.toFixed(2)}):h=6:color=0xF5A623:t=fill`;

  // Combine all filters
  const allFilters = [vignetteFilter, progressFilter, ...drawtextFilters].join(
    ",",
  );

  // Step 4: Apply overlays
  const overlaidPath = path.join(workDir, "overlaid.mp4");
  execSync(
    `ffmpeg -y -i "${rawVideoPath}" ` +
      `-vf "${allFilters}" ` +
      `-c:v libx264 -preset fast -crf 22 -r 30 -pix_fmt yuv420p -an "${overlaidPath}"`,
    { timeout: 300000, stdio: "pipe" },
  );

  // Step 5: Mix audio (voiceover at 100% + music at 10%)
  console.error("Mixing audio...");
  const finalPath = outputPath || path.join(workDir, "final.mp4");

  if (voPath && musicPath) {
    execSync(
      `ffmpeg -y -i "${overlaidPath}" -i "${voPath}" -i "${musicPath}" ` +
        `-filter_complex "[1:a]volume=1.0[vo];[2:a]volume=0.10,afade=t=in:st=0:d=3[mu];[vo][mu]amix=inputs=2:duration=first[aout]" ` +
        `-map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -shortest "${finalPath}"`,
      { timeout: 120000, stdio: "pipe" },
    );
  } else if (voPath) {
    execSync(
      `ffmpeg -y -i "${overlaidPath}" -i "${voPath}" ` +
        `-map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest "${finalPath}"`,
      { timeout: 60000, stdio: "pipe" },
    );
  } else {
    fs.copyFileSync(overlaidPath, finalPath);
  }

  const stat = fs.statSync(finalPath);
  console.error(`Render complete: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);

  // Output result
  console.log(JSON.stringify({ ok: true, path: finalPath, size: stat.size }));

  // Cleanup processed clips (keep final)
  processedClips.forEach((p) => {
    try {
      fs.unlinkSync(p);
    } catch {}
  });
  try {
    fs.unlinkSync(rawVideoPath);
  } catch {}
  try {
    fs.unlinkSync(overlaidPath);
  } catch {}
  try {
    fs.unlinkSync(concatFile);
  } catch {}
} catch (e) {
  console.error("Render error:", e.message);
  console.log(JSON.stringify({ ok: false, error: e.message.slice(0, 500) }));
  process.exit(1);
}
