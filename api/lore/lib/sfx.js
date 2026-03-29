/**
 * api/lore/lib/sfx.js
 * Sound effect placement logic for YouTube Shorts.
 *
 * Places 3 types of SFX based on script content and story template:
 *   - Whoosh: on clip transitions and text pop-ons (subtle)
 *   - Bass boom: on shocking reveals or dramatic moments (1-3 per Short)
 *   - Ambient crowd: under game-related segments (low volume)
 *
 * SFX are placed as audio layers in the Creatomate template.
 * The actual SFX files live in a Google Drive folder or CDN.
 */

// Default SFX library URLs (replace with actual hosted files)
const SFX_LIBRARY = {
  whoosh_soft:    process.env.SFX_WHOOSH_SOFT    || "",
  whoosh_hard:    process.env.SFX_WHOOSH_HARD    || "",
  bass_boom:      process.env.SFX_BASS_BOOM      || "",
  bass_drop:      process.env.SFX_BASS_DROP      || "",
  crowd_roar:     process.env.SFX_CROWD_ROAR     || "",
  crowd_gasp:     process.env.SFX_CROWD_GASP     || "",
  record_scratch: process.env.SFX_RECORD_SCRATCH || "",
  dramatic_hit:   process.env.SFX_DRAMATIC_HIT   || "",
  silence_beat:   process.env.SFX_SILENCE_BEAT   || "",
};

/**
 * Generate SFX placement for a video based on story template and clip slots.
 *
 * @param {object} storyTemplate - From story-templates.js
 * @param {object[]} clipSlots - From calculateClipSlots()
 * @param {string} scriptText - Full script for keyword detection
 * @returns {object[]} Array of SFX placements:
 *   { type, url, time, volume, duration }
 */
function generateSFXPlacements(storyTemplate, clipSlots, scriptText) {
  const placements = [];
  const lower = scriptText.toLowerCase();

  // 1. Whoosh on major segment transitions (not every clip cut)
  const segmentBoundaries = new Set(
    storyTemplate.segments.map(s => s.start).filter(t => t > 0)
  );

  segmentBoundaries.forEach(time => {
    if (SFX_LIBRARY.whoosh_soft) {
      placements.push({
        type: "whoosh",
        url: SFX_LIBRARY.whoosh_soft,
        time: time - 0.1,
        volume: 30,
        duration: 0.5,
      });
    }
  });

  // 2. Bass boom on retention hook timestamps and dramatic moments
  storyTemplate.retentionHooks.forEach(hook => {
    if (SFX_LIBRARY.bass_boom) {
      placements.push({
        type: "bass_boom",
        url: SFX_LIBRARY.bass_boom,
        time: hook.time,
        volume: 45,
        duration: 1.0,
      });
    }
  });

  // 3. Bass boom on shocking keywords in script
  const shockWords = ["banned", "fired", "died", "arrested", "impossible", "never", "record", "greatest"];
  const words = scriptText.split(/\s+/);
  const secondsPerWord = 55 / words.length;
  words.forEach((word, i) => {
    const clean = word.toLowerCase().replace(/[.,!?;:'"()-]/g, "");
    if (shockWords.includes(clean) && SFX_LIBRARY.dramatic_hit) {
      const time = i * secondsPerWord;
      // Don't stack too close to existing placements
      const tooClose = placements.some(p => Math.abs(p.time - time) < 3);
      if (!tooClose) {
        placements.push({
          type: "dramatic_hit",
          url: SFX_LIBRARY.dramatic_hit,
          time,
          volume: 35,
          duration: 0.8,
        });
      }
    }
  });

  // 4. Ambient crowd noise under action segments
  storyTemplate.segments.forEach(seg => {
    if (["action", "reaction"].includes(seg.clipCategory) && SFX_LIBRARY.crowd_roar) {
      placements.push({
        type: "crowd_ambient",
        url: SFX_LIBRARY.crowd_roar,
        time: seg.start,
        volume: 12,
        duration: seg.end - seg.start,
      });
    }
  });

  // 5. Music drop (silence) right before the biggest reveal
  // Place 1 second of silence before the "turn" or "twist" segment
  const turnSegment = storyTemplate.segments.find(s =>
    ["turn", "twist", "unravel", "collision", "bottom"].includes(s.name)
  );
  if (turnSegment) {
    placements.push({
      type: "music_drop",
      url: null,
      time: turnSegment.start - 1,
      volume: 0,
      duration: 1.5,
      note: "Drop music to silence for 1.5s before the turn",
    });
  }

  // Sort by time and limit to avoid overwhelming the audio
  return placements
    .filter(p => p.time >= 0 && p.time < 55)
    .sort((a, b) => a.time - b.time)
    .slice(0, 15); // Max 15 SFX per video
}

module.exports = { SFX_LIBRARY, generateSFXPlacements };
