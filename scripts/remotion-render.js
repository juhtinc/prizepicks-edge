/**
 * Remotion Video Renderer (VPS)
 * Bundles the Remotion composition and renders to MP4.
 * Same stdin/stdout contract as vps-render.js (FFmpeg fallback).
 *
 * Input: JSON via stdin with { clips, voiceoverUrl, musicUrl, captions, playerName, duration, outroStart, outputPath }
 * Output: JSON on stdout with { ok, path, size }
 *
 * Usage:
 *   echo '{"clips":[...]}' | node remotion-render.js
 *   node remotion-render.js --bundle-only   (pre-bundle without rendering)
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REMOTION_DIR = path.join(__dirname, "..", "remotion");
const BUNDLE_DIR = path.join(REMOTION_DIR, "build", "bundle");
const ENTRY_POINT = path.join(REMOTION_DIR, "src", "index.ts");

// If running on VPS, paths are different
const VPS_REMOTION_DIR = "/opt/sports-lore/remotion";
const VPS_BUNDLE_DIR = path.join(VPS_REMOTION_DIR, "build", "bundle");
const VPS_ENTRY_POINT = path.join(VPS_REMOTION_DIR, "src", "index.ts");

function getRemotionDir() {
  if (fs.existsSync(VPS_REMOTION_DIR)) return VPS_REMOTION_DIR;
  return REMOTION_DIR;
}

function getBundleDir() {
  if (fs.existsSync(VPS_REMOTION_DIR)) return VPS_BUNDLE_DIR;
  return BUNDLE_DIR;
}

function getEntryPoint() {
  if (fs.existsSync(VPS_REMOTION_DIR)) return VPS_ENTRY_POINT;
  return ENTRY_POINT;
}

async function bundleComposition() {
  const { bundle } = require(
    path.join(getRemotionDir(), "node_modules", "@remotion/bundler"),
  );

  const bundleDir = getBundleDir();
  fs.mkdirSync(path.dirname(bundleDir), { recursive: true });

  console.error("Bundling Remotion composition...");
  const bundleLocation = await bundle({
    entryPoint: getEntryPoint(),
    outDir: bundleDir,
  });
  console.error("Bundle complete: " + bundleLocation);
  return bundleLocation;
}

async function renderVideo(input) {
  const remotionDir = getRemotionDir();
  const { renderMedia, selectComposition } = require(
    path.join(remotionDir, "node_modules", "@remotion/renderer"),
  );

  const bundleDir = getBundleDir();

  // Check if bundle exists, if not create it
  let serveUrl;
  if (fs.existsSync(path.join(bundleDir, "index.html"))) {
    serveUrl = bundleDir;
    console.error("Using cached bundle");
  } else {
    serveUrl = await bundleComposition();
  }

  const {
    clips,
    voiceoverUrl,
    musicUrl,
    captions,
    playerName,
    duration,
    outroStart,
    outputPath,
  } = input;

  const finalOutput =
    outputPath || "/tmp/remotion-render-" + Date.now() + ".mp4";

  // Pre-download all remote assets to local files for reliable rendering
  const dlDir = "/tmp/remotion-assets-" + Date.now();
  fs.mkdirSync(dlDir, { recursive: true });

  function dlFile(url, filename) {
    const out = path.join(dlDir, filename);
    console.error("  Downloading " + filename + "...");
    execSync(`curl -sL -o "${out}" "${url}"`, {
      timeout: 30000,
      stdio: "pipe",
    });
    return "file://" + out;
  }

  console.error(
    "Pre-downloading " + (clips || []).length + " clips + audio...",
  );
  const localClips = (clips || []).map((clip, i) => ({
    ...clip,
    url: clip.url ? dlFile(clip.url, `clip_${i}.mp4`) : clip.url,
  }));
  const localVoiceover = voiceoverUrl
    ? dlFile(voiceoverUrl, "voiceover.mp3")
    : null;
  const localMusic = musicUrl ? dlFile(musicUrl, "music.mp3") : null;
  console.error("All assets downloaded to " + dlDir);

  console.error("Selecting composition...");
  const composition = await selectComposition({
    serveUrl,
    id: "SportsLoreShort",
    inputProps: {
      clips: localClips,
      voiceoverUrl: localVoiceover,
      musicUrl: localMusic,
      captions: captions || [],
      playerName: playerName || "",
      storyType: input.storyType || "forgotten_legend",
      duration: duration || 59,
      outroStart: outroStart || null,
    },
  });

  console.error(
    `Rendering ${composition.durationInFrames} frames at ${composition.fps}fps (${composition.width}x${composition.height})...`,
  );

  let lastProgress = 0;
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: finalOutput,
    inputProps: {
      clips: localClips,
      voiceoverUrl: localVoiceover,
      musicUrl: localMusic,
      captions: captions || [],
      playerName: playerName || "",
      storyType: input.storyType || "forgotten_legend",
      duration: duration || 59,
      outroStart: outroStart || null,
    },
    chromiumOptions: {
      gl: "swangle",
    },
    concurrency: 1, // safer on 8GB RAM VPS
    timeoutInMilliseconds: 1200000, // 20 min per-frame timeout
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100);
      if (pct > lastProgress) {
        process.stderr.write(`\rProgress: ${pct}%`);
        lastProgress = pct;
      }
    },
  });

  process.stderr.write("\n");
  const stat = fs.statSync(finalOutput);
  console.error(
    `Render complete: ${(stat.size / 1024 / 1024).toFixed(1)}MB at ${finalOutput}`,
  );

  // Cleanup downloaded assets
  try {
    fs.rmSync(dlDir, { recursive: true, force: true });
  } catch {}

  return { ok: true, path: finalOutput, size: stat.size };
}

// Main
(async () => {
  try {
    // Bundle-only mode
    if (process.argv.includes("--bundle-only")) {
      await bundleComposition();
      process.exit(0);
    }

    // Read input from stdin
    const input = JSON.parse(fs.readFileSync("/dev/stdin", "utf8"));
    const result = await renderVideo(input);
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error("Remotion render error:", e.message);
    console.log(JSON.stringify({ ok: false, error: e.message.slice(0, 500) }));
    process.exit(1);
  }
})();
