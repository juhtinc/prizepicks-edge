/**
 * api/lore/lib/stat-overlays.js
 * Generates animated stat line overlays for Sports Lore videos.
 *
 * Stat overlays appear over gameplay clips at key moments:
 *   - Hero stats: giant centered number (e.g., "100 PTS")
 *   - Stat bars: animated comparison bars (Player A vs Player B)
 *   - Ticker: scrolling stat line at bottom ("27.4 PPG | 11.5 RPG | 3.6 APG")
 *   - Pop-up: quick stat that appears and disappears mid-clip
 *
 * These overlays are rendered by Creatomate as text/shape elements.
 */

const { askClaudeJSON } = require("./claude");

/**
 * Extract stat-worthy moments from a script using Claude.
 * Returns timed stat overlays that should appear during the video.
 *
 * @param {string} scriptText - Full voiceover script
 * @param {string} playerName - Player name
 * @param {string} sport - Sport (NBA, NFL, etc.)
 * @param {object[]} segments - Story template segments with timestamps
 * @returns {object[]} Array of stat overlay objects for Creatomate
 */
async function generateStatOverlays(scriptText, playerName, sport, segments) {
  const segmentGuide = segments
    .map(s => `[${s.start}s-${s.end}s] ${s.name}: ${s.description}`)
    .join("\n");

  const prompt = `You are a sports graphics designer for a YouTube Shorts channel.

Analyze this script and identify 3-5 moments where a STAT OVERLAY should appear on screen. These are animated graphics that show key numbers over the gameplay footage.

Script about ${playerName} (${sport}):
${scriptText}

Video segments:
${segmentGuide}

For each stat moment, specify:
- type: "hero" (giant centered number, 1.5s hold) | "ticker" (scrolling stat line at bottom, 3s) | "popup" (quick stat card, 2s) | "comparison" (side-by-side bars, 3s)
- time: when it should appear (match the voiceover moment)
- duration: how long it stays on screen
- content: the exact text/numbers to display
- highlight: which number or word gets the emphasis color

Rules:
- Hero stats should be used for the MOST impressive single number (only 1-2 per video)
- Ticker is good for a string of stats that establish dominance
- Popup works for quick contextual facts
- Comparison is for rivalry/GOAT debate stories only
- Time each overlay to appear RIGHT when the voiceover says that stat

Return JSON:
{"overlays":[{"type":"hero|ticker|popup|comparison","time":10.5,"duration":1.5,"content":"100 PTS","highlight":"100","context":"Wilt's 100-point game stat"},...]}`;

  const result = await askClaudeJSON(prompt, { maxTokens: 600 });
  return result.overlays || [];
}

/**
 * Convert stat overlays to Creatomate element modifications.
 * Returns modifications object for the Creatomate render API.
 */
function statOverlaysToCreatomate(overlays) {
  const modifications = {};

  overlays.forEach((overlay, i) => {
    const key = `stat_overlay_${i + 1}`;

    switch (overlay.type) {
      case "hero":
        // Giant centered number
        modifications[`${key}_text`] = overlay.content;
        modifications[`${key}_time`] = overlay.time;
        modifications[`${key}_duration`] = overlay.duration || 1.5;
        modifications[`${key}_type`] = "hero";
        modifications[`${key}_highlight`] = overlay.highlight || "";
        break;

      case "ticker":
        // Scrolling stat line at bottom
        modifications[`${key}_text`] = overlay.content;
        modifications[`${key}_time`] = overlay.time;
        modifications[`${key}_duration`] = overlay.duration || 3;
        modifications[`${key}_type`] = "ticker";
        break;

      case "popup":
        // Quick stat card
        modifications[`${key}_text`] = overlay.content;
        modifications[`${key}_time`] = overlay.time;
        modifications[`${key}_duration`] = overlay.duration || 2;
        modifications[`${key}_type`] = "popup";
        break;

      case "comparison":
        // Side-by-side comparison bars
        modifications[`${key}_text`] = overlay.content;
        modifications[`${key}_time`] = overlay.time;
        modifications[`${key}_duration`] = overlay.duration || 3;
        modifications[`${key}_type`] = "comparison";
        modifications[`${key}_highlight`] = overlay.highlight || "";
        break;
    }
  });

  return modifications;
}

module.exports = { generateStatOverlays, statOverlaysToCreatomate };
