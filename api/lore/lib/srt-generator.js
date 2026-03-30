/**
 * api/lore/lib/srt-generator.js
 * Converts caption timing data to SRT format for YouTube closed captions upload.
 *
 * YouTube uses SRT captions for:
 *   - Search indexing (major SEO benefit)
 *   - Auto-translate to 100+ languages
 *   - Accessibility (15% of viewers use CC)
 *   - Topic classification (helps recommendations)
 */

const { generateCaptions } = require("./captions");

/**
 * Convert seconds to SRT timestamp format: HH:MM:SS,mmm
 */
function toSRTTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/**
 * Generate an SRT subtitle file from a script.
 *
 * @param {string} scriptText - Full voiceover script
 * @param {number} duration - Video duration in seconds (default 55)
 * @returns {string} SRT file content
 */
function generateSRT(scriptText, duration = 55) {
  const captions = generateCaptions(scriptText, duration);

  // Group into 4-6 word subtitle lines (readable at a glance)
  const lines = [];
  let currentLine = [];
  let lineStart = null;
  let lineEnd = null;

  captions.forEach((cap, i) => {
    if (lineStart === null) lineStart = cap.start;
    currentLine.push(cap.text);
    lineEnd = cap.start + cap.duration;

    // Break at sentence boundaries or every 5-6 words
    const isEndOfSentence = /[.!?]$/.test(cap.text);
    const isLongEnough = currentLine.length >= 5;
    const isLastWord = i === captions.length - 1;

    if (isEndOfSentence || isLongEnough || isLastWord) {
      lines.push({
        index: lines.length + 1,
        start: lineStart,
        end: Math.min(lineEnd + 0.3, duration), // Slight hold after last word
        text: currentLine.join(" "),
      });
      currentLine = [];
      lineStart = null;
      lineEnd = null;
    }
  });

  // Format as SRT
  return lines.map(line =>
    `${line.index}\n${toSRTTime(line.start)} --> ${toSRTTime(line.end)}\n${line.text}\n`
  ).join("\n");
}

/**
 * Generate SRT and return as a Buffer for YouTube API upload.
 */
function generateSRTBuffer(scriptText, duration = 55) {
  const srt = generateSRT(scriptText, duration);
  return Buffer.from(srt, "utf-8");
}

module.exports = { generateSRT, generateSRTBuffer, toSRTTime };
