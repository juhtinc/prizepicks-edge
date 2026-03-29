/**
 * api/lore/lib/clip-scraper.js
 * Scrapes real player footage from YouTube for use in Sports Lore Shorts.
 *
 * Strategy for fair use / transformative content:
 *   1. Only download 2-4 second segments (never full videos)
 *   2. Each clip is transformed: cropped, zoomed, speed-shifted, color-graded
 *   3. Original voiceover commentary is the primary content (transformative use)
 *   4. Clips serve as visual reference for commentary, not standalone entertainment
 *
 * Uses yt-dlp for downloading and YouTube Data API for search.
 * yt-dlp must be installed on the server (or use a cloud function with it bundled).
 *
 * Env vars:
 *   YOUTUBE_API_KEY — for search
 *   YT_DLP_PATH — path to yt-dlp binary (default: "yt-dlp")
 *   CLIP_STORAGE_URL — base URL where processed clips are stored (S3, GCS, etc.)
 */

const axios = require("axios");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const YT_API_KEY = process.env.YOUTUBE_API_KEY;
const YT_DLP = process.env.YT_DLP_PATH || "yt-dlp";
const CLIP_STORAGE_URL = process.env.CLIP_STORAGE_URL || "";

/**
 * Search YouTube for highlight videos of a specific player.
 * Returns an array of { videoId, title, duration } sorted by relevance.
 */
async function searchPlayerHighlights(playerName, sport, options = {}) {
  const { year, team, maxResults = 10 } = options;

  // Build search queries — multiple queries for better coverage
  const queries = [
    `${playerName} highlights`,
    `${playerName} ${sport} best plays`,
    `${playerName} ${team || ""} highlights ${year || ""}`.trim(),
  ];

  const allResults = [];

  for (const query of queries) {
    try {
      const resp = await axios.get("https://www.googleapis.com/youtube/v3/search", {
        params: {
          part: "snippet",
          q: query,
          type: "video",
          videoDuration: "medium",  // 4-20 minutes (highlight compilations)
          maxResults,
          order: "relevance",
          key: YT_API_KEY,
        },
      });

      const items = resp.data?.items || [];
      for (const item of items) {
        const videoId = item.id?.videoId;
        if (!videoId) continue;

        // Skip if already found
        if (allResults.some(r => r.videoId === videoId)) continue;

        allResults.push({
          videoId,
          title: item.snippet.title,
          channelTitle: item.snippet.channelTitle,
          thumbnail: item.snippet.thumbnails?.high?.url,
          query,
        });
      }
    } catch (e) {
      console.error(`[clip-scraper] Search failed for "${query}":`, e.message);
    }
  }

  return allResults.slice(0, maxResults);
}

/**
 * Download a specific time segment from a YouTube video using yt-dlp.
 * Returns the local file path of the downloaded clip.
 *
 * @param {string} videoId - YouTube video ID
 * @param {number} startTime - Start time in seconds
 * @param {number} duration - Clip duration in seconds (2-4s recommended)
 * @param {string} outputDir - Directory to save clip
 * @returns {string} Path to downloaded clip file
 */
function downloadClipSegment(videoId, startTime, duration, outputDir) {
  const outputFile = path.join(outputDir, `clip_${videoId}_${startTime}.mp4`);
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    // yt-dlp with section download: only grab the specific time range
    const cmd = [
      YT_DLP,
      "--no-playlist",
      "--format", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]",
      "--download-sections", `*${formatTime(startTime)}-${formatTime(startTime + duration)}`,
      "--force-keyframes-at-cuts",
      "--merge-output-format", "mp4",
      "--output", `"${outputFile}"`,
      "--no-warnings",
      "--quiet",
      `"${url}"`,
    ].join(" ");

    execSync(cmd, { timeout: 30000, stdio: "pipe" });

    if (fs.existsSync(outputFile)) {
      return outputFile;
    }
  } catch (e) {
    console.error(`[clip-scraper] Download failed for ${videoId} at ${startTime}s:`, e.message);
  }

  return null;
}

/**
 * Search for a player photo/portrait image.
 * Returns a URL to a high-quality player photo.
 */
async function searchPlayerPhoto(playerName, sport) {
  // Use YouTube thumbnail from a highlight video as fallback
  const results = await searchPlayerHighlights(playerName, sport, { maxResults: 1 });
  if (results.length > 0) {
    return results[0].thumbnail;
  }
  return null;
}

/**
 * Extract multiple clip segments from a single highlight video.
 * Spreads clips across the video to get variety (not all from the first 30 seconds).
 *
 * @param {string} videoId - YouTube video ID
 * @param {number} numClips - How many clips to extract
 * @param {number} clipDuration - Duration of each clip in seconds
 * @param {number} videoDuration - Approximate video duration in seconds
 * @param {string} outputDir - Directory to save clips
 * @returns {string[]} Array of local file paths
 */
function extractClipsFromVideo(videoId, numClips, clipDuration = 3, videoDuration = 300, outputDir) {
  const clips = [];
  // Spread clips evenly across the video, skipping first 10s and last 10s (intros/outros)
  const usableRange = videoDuration - 20;
  const interval = usableRange / (numClips + 1);

  for (let i = 1; i <= numClips; i++) {
    const startTime = 10 + Math.floor(interval * i);
    // Add slight randomness (+/- 2 seconds) to avoid predictable pattern
    const jitter = Math.floor(Math.random() * 4) - 2;
    const adjustedStart = Math.max(10, startTime + jitter);

    const filePath = downloadClipSegment(videoId, adjustedStart, clipDuration, outputDir);
    if (filePath) {
      clips.push({ filePath, startTime: adjustedStart, videoId });
    }
  }

  return clips;
}

/**
 * Full pipeline: search for a player, find highlight videos, extract clips.
 * Returns an array of local clip file paths ready for transformation.
 */
async function scrapePlayerClips(playerName, sport, numClips = 12, options = {}) {
  const { year, team, clipDuration = 3 } = options;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "lore-clips-"));

  // Step 1: Find highlight videos
  const highlights = await searchPlayerHighlights(playerName, sport, { year, team, maxResults: 5 });
  if (!highlights.length) {
    console.error(`[clip-scraper] No highlights found for ${playerName}`);
    return { clips: [], outputDir };
  }

  // Step 2: Distribute clips across multiple source videos for variety
  const clips = [];
  const clipsPerVideo = Math.ceil(numClips / Math.min(highlights.length, 3));

  for (const highlight of highlights.slice(0, 3)) {
    if (clips.length >= numClips) break;

    const remaining = numClips - clips.length;
    const toExtract = Math.min(clipsPerVideo, remaining);

    const extracted = extractClipsFromVideo(
      highlight.videoId,
      toExtract,
      clipDuration,
      300, // assume ~5 min highlight video
      outputDir
    );

    extracted.forEach(clip => {
      clips.push({
        ...clip,
        sourceTitle: highlight.title,
        sourceChannel: highlight.channelTitle,
      });
    });
  }

  return { clips, outputDir, sourceVideos: highlights.slice(0, 3) };
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

module.exports = {
  searchPlayerHighlights, downloadClipSegment, searchPlayerPhoto,
  extractClipsFromVideo, scrapePlayerClips, formatTime,
};
