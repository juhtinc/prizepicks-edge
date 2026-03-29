/**
 * api/lore/lib/clip-transformer.js
 * Applies transformative edits to scraped clips for fair use defense.
 *
 * Each clip goes through multiple transformations so the final output
 * is meaningfully different from the source material:
 *
 *   1. Crop & reframe: 60-80% of original frame, random offset
 *   2. Ken Burns zoom: slow 100% → 112% push-in
 *   3. Speed shift: 92-108% (barely noticeable but technically different)
 *   4. Color grade: slight tint shift + contrast adjustment per mood
 *   5. Mirror flip: 50% chance of horizontal flip (doubles perceived variety)
 *   6. Vignette: subtle dark edges to focus attention center
 *   7. Film grain: light noise overlay for stylistic consistency
 *
 * Uses FFmpeg for all transformations. FFmpeg must be installed on the server.
 *
 * Env vars:
 *   FFMPEG_PATH — path to ffmpeg binary (default: "ffmpeg")
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

// Color grade presets per mood (maps to story template moods)
const COLOR_GRADES = {
  nostalgic:   { contrast: 1.1, brightness: -0.02, saturation: 0.85, hue: 15,  tint: "sepia" },
  melancholy:  { contrast: 1.15, brightness: -0.05, saturation: 0.7, hue: 210, tint: "cool" },
  epic:        { contrast: 1.2, brightness: 0.02, saturation: 1.15, hue: 0,    tint: "warm" },
  hype:        { contrast: 1.25, brightness: 0.03, saturation: 1.2, hue: 0,    tint: "vivid" },
  dark:        { contrast: 1.3, brightness: -0.08, saturation: 0.6, hue: 240,  tint: "cold" },
  intense:     { contrast: 1.2, brightness: 0.0, saturation: 1.1, hue: 350,    tint: "warm" },
  inspiring:   { contrast: 1.1, brightness: 0.03, saturation: 1.05, hue: 30,   tint: "golden" },
  mysterious:  { contrast: 1.15, brightness: -0.03, saturation: 0.8, hue: 260, tint: "purple" },
  dramatic:    { contrast: 1.2, brightness: -0.02, saturation: 0.95, hue: 0,   tint: "neutral" },
  default:     { contrast: 1.1, brightness: 0.0, saturation: 1.0, hue: 0,      tint: "neutral" },
};

/**
 * Apply all transformations to a single clip.
 *
 * @param {string} inputPath - Path to source clip
 * @param {string} outputPath - Path for transformed clip
 * @param {object} options - Transformation options
 * @param {string} options.mood - Color grade mood (from story template)
 * @param {number} options.cropPercent - How much to crop (0.6 = 60% of frame, default random 0.65-0.8)
 * @param {number} options.speedFactor - Playback speed (default random 0.93-1.07)
 * @param {boolean} options.mirror - Horizontal flip (default random 50%)
 * @param {boolean} options.addGrain - Add film grain (default true)
 * @param {boolean} options.addVignette - Add vignette (default true)
 * @returns {string|null} Output path if successful, null if failed
 */
function transformClip(inputPath, outputPath, options = {}) {
  const mood = options.mood || "default";
  const grade = COLOR_GRADES[mood] || COLOR_GRADES.default;

  // Randomize parameters for variety across clips
  const cropPercent = options.cropPercent || (0.65 + Math.random() * 0.15);
  const speedFactor = options.speedFactor || (0.93 + Math.random() * 0.14);
  const mirror = options.mirror !== undefined ? options.mirror : Math.random() > 0.5;
  const addGrain = options.addGrain !== false;
  const addVignette = options.addVignette !== false;

  // Random crop offset (where in the frame to crop)
  const cropOffsetX = Math.random() * (1 - cropPercent);
  const cropOffsetY = Math.random() * (1 - cropPercent) * 0.5; // Bias toward center vertically

  // Build FFmpeg filter chain
  const filters = [];

  // 1. Crop & reframe to vertical (9:16)
  filters.push(
    `crop=iw*${cropPercent}:ih*${cropPercent}:iw*${cropOffsetX}:ih*${cropOffsetY}`
  );

  // 2. Scale to 1080x1920 (vertical Shorts)
  filters.push("scale=1080:1920:force_original_aspect_ratio=increase");
  filters.push("crop=1080:1920");

  // 3. Ken Burns zoom (slow push-in via zoompan)
  // Note: zoompan replaces scale, so we apply it differently
  // Instead, we use a subtle scale animation in the Creatomate template
  // Here we just do a slight initial zoom offset
  filters.push("scale=1188:2112"); // 110% overscan
  filters.push("crop=1080:1920:(iw-1080)/2:(ih-1920)/2");

  // 4. Speed shift
  if (speedFactor !== 1.0) {
    filters.push(`setpts=${(1 / speedFactor).toFixed(4)}*PTS`);
  }

  // 5. Mirror flip
  if (mirror) {
    filters.push("hflip");
  }

  // 6. Color grading
  filters.push(
    `eq=contrast=${grade.contrast}:brightness=${grade.brightness}:saturation=${grade.saturation}`
  );

  // 7. Slight color tint via colorbalance
  if (grade.tint === "sepia") {
    filters.push("colorbalance=rs=0.1:gs=0.05:bs=-0.05:rm=0.1:gm=0.05:bm=-0.05");
  } else if (grade.tint === "cool") {
    filters.push("colorbalance=rs=-0.05:bs=0.1:rm=-0.05:bm=0.08");
  } else if (grade.tint === "warm") {
    filters.push("colorbalance=rs=0.08:gs=0.03:bs=-0.05:rm=0.05:gm=0.02:bm=-0.03");
  } else if (grade.tint === "golden") {
    filters.push("colorbalance=rs=0.1:gs=0.06:bs=-0.08:rm=0.08:gm=0.04:bm=-0.06");
  } else if (grade.tint === "cold") {
    filters.push("colorbalance=rs=-0.08:bs=0.12:rm=-0.06:bm=0.1");
  } else if (grade.tint === "vivid") {
    filters.push("colorbalance=rs=0.05:gs=-0.02:bs=0.05");
  } else if (grade.tint === "purple") {
    filters.push("colorbalance=rs=0.05:bs=0.1:rm=0.03:bm=0.08");
  }

  // 8. Vignette
  if (addVignette) {
    filters.push("vignette=PI/4");
  }

  // 9. Film grain (subtle noise)
  if (addGrain) {
    filters.push("noise=alls=8:allf=t");
  }

  const filterChain = filters.join(",");

  try {
    const cmd = [
      FFMPEG,
      "-y",
      "-i", `"${inputPath}"`,
      "-vf", `"${filterChain}"`,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-an",  // Strip audio (we have our own voiceover)
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      `"${outputPath}"`,
    ].join(" ");

    execSync(cmd, { timeout: 30000, stdio: "pipe" });

    if (fs.existsSync(outputPath)) {
      return outputPath;
    }
  } catch (e) {
    console.error(`[clip-transformer] Transform failed:`, e.message);
  }

  return null;
}

/**
 * Transform all clips in a batch with mood-appropriate color grading.
 *
 * @param {object[]} clips - Array of { filePath, startTime, videoId }
 * @param {string} mood - Color grade mood for this story
 * @param {string} outputDir - Directory for transformed clips
 * @returns {object[]} Array of { originalPath, transformedPath, transforms }
 */
function transformClipBatch(clips, mood, outputDir) {
  const results = [];

  clips.forEach((clip, i) => {
    const outputPath = path.join(outputDir, `transformed_${i + 1}.mp4`);
    const cropPercent = 0.65 + Math.random() * 0.15;
    const speedFactor = 0.93 + Math.random() * 0.14;
    const mirror = Math.random() > 0.5;

    const transformed = transformClip(clip.filePath, outputPath, {
      mood,
      cropPercent,
      speedFactor,
      mirror,
    });

    results.push({
      slot: i + 1,
      originalPath: clip.filePath,
      transformedPath: transformed,
      sourceVideoId: clip.videoId,
      transforms: {
        cropPercent: Math.round(cropPercent * 100),
        speedFactor: Math.round(speedFactor * 100) / 100,
        mirrored: mirror,
        colorGrade: mood,
        vignette: true,
        filmGrain: true,
      },
    });
  });

  return results;
}

/**
 * Upload transformed clips to cloud storage and return URLs.
 * Placeholder — in production, upload to S3/GCS/Cloudflare R2.
 */
async function uploadTransformedClips(transformedClips) {
  // For now, return local paths. In production:
  // 1. Upload each transformed clip to cloud storage
  // 2. Return public URLs for Creatomate to access
  return transformedClips.map(clip => ({
    ...clip,
    url: clip.transformedPath ? `${CLIP_STORAGE_URL}/${path.basename(clip.transformedPath)}` : null,
  }));
}

module.exports = {
  COLOR_GRADES, transformClip, transformClipBatch, uploadTransformedClips,
};
