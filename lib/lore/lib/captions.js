/**
 * api/lore/lib/captions.js
 * Word-by-word animated caption generation for YouTube Shorts.
 *
 * Based on retention research: word-by-word highlighting is the #1 visual
 * element for Shorts retention. Active word is highlighted in a contrasting
 * color, key words (names, numbers, superlatives) get extra emphasis.
 *
 * This module generates caption data that Creatomate renders as animated text.
 */

// Words that get highlighted in the emphasis color (yellow/gold)
const EMPHASIS_PATTERNS = [
  /^\d+[\d,.]*$/,                    // Numbers: "100", "47.5", "1,000"
  /^#\d+$/,                          // Rankings: "#1", "#3"
  /^(never|nobody|no one|impossible|insane|unbelievable|greatest|worst|only|first|last|record|goat|legend|banned|fired|traded|injured|retired|died|championship|mvp|finals|playoffs|draft|rookie|hall of fame)$/i,
];

function isEmphasisWord(word) {
  const clean = word.replace(/[.,!?;:'"()-]/g, "");
  return EMPHASIS_PATTERNS.some(p => p.test(clean));
}

/**
 * Generate caption data from a script for Creatomate rendering.
 *
 * @param {string} scriptText - Full voiceover script
 * @param {number} totalDuration - Video duration in seconds (default 55)
 * @param {number} wordsPerMinute - Speaking pace (default 165)
 * @returns {object[]} Array of caption objects for Creatomate:
 *   { text, start, duration, isEmphasis, isHeroStat, groupIndex }
 *
 * Caption display modes:
 *   - Normal words: white text, appears for ~0.35s
 *   - Emphasis words: gold/yellow text, slightly larger, appears for ~0.5s
 *   - Hero stats: giant centered number/word, holds for 1.5s
 */
function generateCaptions(scriptText, totalDuration = 55, wordsPerMinute = 165) {
  const words = scriptText.split(/\s+/).filter(Boolean);
  const totalWords = words.length;

  // Calculate timing: seconds per word based on WPM
  const secondsPerWord = 60 / wordsPerMinute;
  const captions = [];

  // Group words into 2-3 word phrases for display
  let currentTime = 0;
  let groupIndex = 0;

  for (let i = 0; i < totalWords; i++) {
    const word = words[i];
    const clean = word.replace(/[.,!?;:'"()-]/g, "");
    const emphasis = isEmphasisWord(word);

    // Hero stat detection: standalone number or very short powerful phrase
    const isHeroStat = /^\d{2,}$/.test(clean) && (i === 0 || /[.!?]$/.test(words[i - 1] || ""));

    const wordDuration = emphasis ? secondsPerWord * 1.3 : secondsPerWord;
    const displayDuration = isHeroStat ? 1.5 : emphasis ? 0.5 : 0.35;

    captions.push({
      text: word,
      start: Math.round(currentTime * 100) / 100,
      duration: Math.round(displayDuration * 100) / 100,
      isEmphasis: emphasis,
      isHeroStat,
      groupIndex,
    });

    currentTime += wordDuration;

    // New group every 2-3 words or at sentence boundaries
    if ((i + 1) % 3 === 0 || /[.!?]$/.test(word)) {
      groupIndex++;
    }
  }

  // Scale timing to fit total duration if needed
  if (currentTime > totalDuration && captions.length > 0) {
    const scale = totalDuration / currentTime;
    captions.forEach(c => {
      c.start = Math.round(c.start * scale * 100) / 100;
      c.duration = Math.round(c.duration * scale * 100) / 100;
    });
  }

  return captions;
}

/**
 * Convert captions to Creatomate text element modifications.
 * Groups words into 2-3 word display chunks with highlight on active word.
 */
function captionsToCreatomate(captions) {
  const groups = [];
  let currentGroup = [];

  captions.forEach((cap, i) => {
    currentGroup.push(cap);
    if (cap.groupIndex !== captions[i + 1]?.groupIndex || i === captions.length - 1) {
      groups.push([...currentGroup]);
      currentGroup = [];
    }
  });

  return groups.map((group, i) => ({
    name: `caption_${i + 1}`,
    text: group.map(w => w.text).join(" "),
    start: group[0].start,
    duration: group.reduce((sum, w) => sum + w.duration, 0) + 0.15,
    hasEmphasis: group.some(w => w.isEmphasis),
    hasHeroStat: group.some(w => w.isHeroStat),
    emphasisWords: group.filter(w => w.isEmphasis).map(w => w.text),
  }));
}

module.exports = { generateCaptions, captionsToCreatomate, isEmphasisWord };
