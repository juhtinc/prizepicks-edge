/**
 * lib/lore/lib/video-composer.js
 * Builds a dynamic Creatomate JSON composition programmatically (no template_id).
 * Matches the storyboard format from example-preview-v2.html:
 *   - 1080x1920 vertical short, ~55-60s
 *   - 12-track layout: footage → vignette → gradient → flash → captions →
 *     reveal overlays → lower third → phase badge → UI → progress → VO → music
 *   - Reveal segments: blurred/dimmed footage, stat or quote overlay, gold lines
 *   - Phase badge top-right, lower third bottom-left
 *   - Vignette + bottom fade for cinematic look
 */

const { getStoryTemplate } = require("./story-templates");

// ── Brand constants ──
const BRAND_GOLD = "#F5A623";
const FONT = "Montserrat";
const WIDTH = 1080;
const HEIGHT = 1920;

// Stock footage library organized by clip category (matches story template segments)
// Creatomate crops landscape to portrait with fit: "cover"
const STOCK_FOOTAGE = {
  // Action/gameplay — dunks, plays, highlights
  action: [
    "https://videos.pexels.com/video-files/5192026/5192026-hd_1920_1080_30fps.mp4",  // dunk
    "https://videos.pexels.com/video-files/5191590/5191590-hd_1920_1080_30fps.mp4",  // dunk 2
    "https://videos.pexels.com/video-files/6254854/6254854-hd_1080_1920_30fps.mp4",  // scoring (vertical)
    "https://videos.pexels.com/video-files/5192151/5192151-hd_1920_1080_30fps.mp4",  // shooting hoop
  ],
  // Era/context — courts, environments, establishing shots
  era: [
    "https://videos.pexels.com/video-files/5586521/5586521-hd_1920_1080_25fps.mp4",  // dribbling on court
    "https://videos.pexels.com/video-files/5192157/5192157-hd_1920_1080_30fps.mp4",  // playing game
    "https://videos.pexels.com/video-files/5586538/5586538-hd_1080_1920_25fps.mp4",  // court dribble (vertical)
  ],
  // Atmosphere — mood, stadium, dramatic
  atmosphere: [
    "https://videos.pexels.com/video-files/5586522/5586522-hd_1920_1080_25fps.mp4",  // player focus
    "https://videos.pexels.com/video-files/6070825/6070825-hd_1920_1080_24fps.mp4",  // playing basketball
    "https://videos.pexels.com/video-files/5000177/5000177-hd_1920_1080_30fps.mp4",  // dribbling
  ],
  // Stadium/crowd — fan reactions, arenas
  stadium: [
    "https://videos.pexels.com/video-files/4036306/4036306-hd_1080_1920_30fps.mp4",  // crowd cheering (vertical)
    "https://videos.pexels.com/video-files/3192023/3192023-hd_1920_1080_25fps.mp4",  // sport fans
    "https://videos.pexels.com/video-files/3192196/3192196-hd_1920_1080_25fps.mp4",  // fans with wigs
  ],
  // Stats/legacy — contemplative, slow
  stats: [
    "https://videos.pexels.com/video-files/5192072/5192072-hd_1920_1080_30fps.mp4",  // spinning ball
    "https://videos.pexels.com/video-files/5586522/5586522-hd_1920_1080_25fps.mp4",  // player contemplative
  ],
  // Reaction — celebration, intensity
  reaction: [
    "https://videos.pexels.com/video-files/3722009/3722009-hd_1920_1080_24fps.mp4",  // happy people cheering
    "https://videos.pexels.com/video-files/4036306/4036306-hd_1080_1920_30fps.mp4",  // crowd (vertical)
  ],
};

// Fallback for unknown categories
const DEFAULT_STOCK_CLIPS = STOCK_FOOTAGE.action;

/**
 * Determine if a segment is a "reveal" type (stat, comparison, hero number).
 * Reveal segments get blurred/dimmed backgrounds and big centered numbers.
 */
function isRevealSegment(segment) {
  const revealNames = ["reveal", "final", "verdict"];
  const name = (segment.name || "").toLowerCase();
  return revealNames.includes(name) || segment.type === "reveal";
}

/**
 * Pick a stock footage URL for a segment based on its clip category.
 * Uses category-specific footage for visual variety between segments.
 * If clipUrls are provided (from clip-sourcer), use those first.
 */
function pickFootageUrl(segIndex, clipUrls, clipCategory) {
  if (clipUrls && clipUrls.length > 0) {
    return clipUrls[segIndex % clipUrls.length];
  }
  // Pick from category-specific library, cycling within that category
  const category = (clipCategory || "action").toLowerCase();
  const pool = STOCK_FOOTAGE[category] || DEFAULT_STOCK_CLIPS;
  return pool[segIndex % pool.length];
}

/**
 * Determine if reveal text is a stat (big number) vs a quote (text message).
 * Stats: start with a digit or contain "NUM UNIT" patterns like "26 PPG".
 * Everything else is a quote reveal.
 */
function isStatReveal(text) {
  if (!text) return false;
  const t = text.trim();
  if (/^\d/.test(t)) return true;
  if (/(\d[\d,.]+)\s*(points?|ppg|rpg|apg|bpg|spg|%|games?|seasons?|wins?|losses?)/i.test(t)) return true;
  return false;
}

/**
 * Extract the main number and unit from stat text.
 * "26 PPG" → { number: "26", unit: "PPG", sublabel: null }
 * "26 PPG · ABA Champion · MVP" → { number: "26", unit: "PPG", sublabel: "ABA Champion · MVP" }
 * "24.6 PPG — 4x All-Star — past his prime" → { number: "24.6", unit: "PPG", sublabel: "4x All-Star · past his prime" }
 */
function parseStatText(text) {
  if (!text) return { number: text || "", unit: "", sublabel: null };
  const m = text.match(/^([\d,.]+)\s*([A-Za-z%]*)/);
  if (!m) return { number: text, unit: "", sublabel: null };
  const number = m[1];
  const unit = m[2] || "";
  // Everything after the first separator (·, —, -, ,) is sublabel
  const rest = text.slice(m[0].length).replace(/^\s*[·—\-,]\s*/, "").trim();
  const sublabel = rest || null;
  return { number, unit, sublabel };
}

/**
 * Build the full Creatomate JSON source composition.
 *
 * @param {Object} opts
 * @param {Object} opts.script        - Full script object from KV
 * @param {string} opts.voiceoverUrl  - URL to the voiceover audio file
 * @param {string} opts.musicTrackUrl - URL to background music (or null)
 * @param {Array}  opts.segments      - Array of {start, end, name, text, type}
 * @param {Array}  opts.captionGroups - Word-by-word caption groups from captionsToCreatomate()
 * @param {Array}  opts.statOverlays  - Stat overlay objects from generateStatOverlays()
 * @param {number} opts.targetDuration - Target duration in seconds (from voiceover length)
 * @returns {Object} Creatomate render JSON source (use with renderComposition)
 */
async function composeVideo({ script, voiceoverUrl, musicTrackUrl, segments, captionGroups, targetDuration }) {
  const template = getStoryTemplate(script.storyType);
  const templateSegments = template.segments;

  // Use provided segments or fall back to template segments with script text split
  const segs = segments && segments.length > 0
    ? segments
    : buildSegmentsFromScript(script, templateSegments);

  const totalDuration = Math.max(
    ...segs.map(s => s.end),
    targetDuration || 55 // use voiceover length, or minimum 55s
  );

  // Collect clip URLs from script if available
  const clipUrls = (script.clipBriefs || [])
    .sort((a, b) => (a.slot || 0) - (b.slot || 0))
    .map(c => c.clipUrl || c.pexelsUrl)
    .filter(Boolean);

  const elements = [];
  let trackCounter = 1;

  // ── Track 1: Background footage layers (one per segment) ──
  const bgTrack = trackCounter++;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    // Last segment extends to totalDuration to prevent black ending
    const segEnd = (i === segs.length - 1) ? Math.max(seg.end, totalDuration) : seg.end;
    const duration = segEnd - seg.start;
    if (duration <= 0) continue;

    const videoEl = {
      type: "video",
      track: bgTrack,
      time: seg.start,
      duration: duration,
      source: pickFootageUrl(i, clipUrls, seg.clipCategory),
      loop: true,
      fit: "cover",
      width: WIDTH,
      height: HEIGHT,
    };

    if (isRevealSegment(seg)) {
      videoEl.blur_radius = 20;
      videoEl.color_overlay = "rgba(0,0,0,0.7)";
    }
    // Light dim on hook footage — stats overlay briefly, footage still visible
    if (i === 0) {
      videoEl.color_overlay = "rgba(0,0,0,0.3)";
    }

    elements.push(videoEl);
  }

  // ── Track 2: Vignette overlay (radial dark edges) ──
  const vignetteTrack = trackCounter++;
  elements.push({
    type: "shape",
    track: vignetteTrack,
    time: 0,
    duration: totalDuration,
    width: WIDTH,
    height: HEIGHT,
    x: WIDTH / 2,
    y: HEIGHT / 2,
    fill_mode: "radial",
    fill_color: [
      { offset: "0%", color: "rgba(0,0,0,0)" },
      { offset: "100%", color: "rgba(0,0,0,0.7)" },
    ],
    fill_x0: "50%",
    fill_y0: "40%",
    fill_radius: "70%",
  });

  // ── Track 3: Gradient overlay (bottom fade for text readability) ──
  const gradientTrack = trackCounter++;
  elements.push({
    type: "shape",
    track: gradientTrack,
    time: 0,
    duration: totalDuration,

    width: WIDTH,
    height: HEIGHT,
    x: WIDTH / 2,
    y: HEIGHT / 2,
    fill_color: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.9) 100%)",
  });

  // ── Track 4: Cut flash transitions between segments ──
  const flashTrack = trackCounter++;
  for (let i = 1; i < segs.length; i++) {
    elements.push({
      type: "shape",
      track: flashTrack,
      time: Math.max(0, segs[i].start - 0.06),
      duration: 0.12,
  
      width: WIDTH,
      height: HEIGHT,
      x: WIDTH / 2,
      y: HEIGHT / 2,
      fill_color: "rgba(255,255,255,0.15)",
      // Flash fades out
      animations: [
        { type: "fade", fade_type: "out", duration: "100%" },
      ],
    });
  }

  // ── Hook stat reveal: extract key stats from hook text and display prominently ──
  const hookEndTime = segs.length > 0 ? segs[0].end : 3;
  const hookStatTrack = trackCounter++;

  // Build hook text — combine all available sources to find stats
  const hookSources = [
    script.hookLine || "",
    (segs.length > 0 ? segs[0].text : ""),
    (captionGroups || []).filter(g => g.start < hookEndTime).map(g => g.text).join(" "),
    (script.description || "").split(/[.!?]/)[0] || "", // first sentence of description
  ].join(" ");

  // Extract stat patterns (e.g. "26 points", "16 rebounds", "397 blocks")
  const hookStats = hookSources.match(/\d[\d,.]*\s*(?:points?|pts?|rebounds?|reb|assists?|ast|blocks?|blk|shots?|steals?|stl|ppg|rpg|apg|bpg|games?|seasons?|wins?|losses?|%)/gi) || [];
  // Deduplicate
  const uniqueHookStats = [...new Set(hookStats.map(s => s.trim().toUpperCase()))];

  if (uniqueHookStats.length > 0) {
    // Brief semi-transparent overlay — fades out after 1.5s so footage shows through
    elements.push({
      type: "shape",
      track: hookStatTrack,
      time: 0,
      duration: 2,
      width: WIDTH,
      height: HEIGHT,
      x: WIDTH / 2,
      y: HEIGHT / 2,
      fill_color: "rgba(0,0,0,0.5)",
      animations: [
        { type: "fade", fade_type: "out", duration: "40%", start_time: "50%" },
      ],
    });

    // Top gold decorative line — brief
    elements.push({
      type: "shape",
      track: hookStatTrack,
      time: 0,
      duration: 2,
      width: WIDTH - 96,
      height: 1,
      x: WIDTH / 2,
      y: 100,
      fill_color: "rgba(245,166,35,0.5)",
    });

    // Bottom gold decorative line — brief
    elements.push({
      type: "shape",
      track: hookStatTrack,
      time: 0,
      duration: 2,
      width: WIDTH - 96,
      height: 1,
      x: WIDTH / 2,
      y: HEIGHT - 220,
      fill_color: "rgba(245,166,35,0.5)",
      animations: [
        { type: "fade", fade_type: "out", duration: "40%", start_time: "50%" },
      ],
    });

    // Abbreviation map for compact display
    const UNIT_ABBREV = {
      POINTS: "PTS", POINT: "PTS", PTS: "PTS",
      REBOUNDS: "REB", REBOUND: "REB", REB: "REB",
      ASSISTS: "AST", ASSIST: "AST", AST: "AST",
      BLOCKS: "BLK", BLOCK: "BLK", BLK: "BLK",
      SHOTS: "BLK", SHOT: "BLK", // "397 shots" in blocking context
      STEALS: "STL", STEAL: "STL", STL: "STL",
      GAMES: "GM", GAME: "GM", SEASONS: "SZN", SEASON: "SZN",
    };

    // Show each stat as "26 PTS" on one line
    for (let si = 0; si < Math.min(uniqueHookStats.length, 2); si++) {
      const stat = uniqueHookStats[si];
      const parts = stat.match(/^([\d,.]+)\s*(.*)/);
      const num = parts ? parts[1] : stat;
      const rawUnit = parts ? parts[2].toUpperCase().trim() : "";
      const abbrev = UNIT_ABBREV[rawUnit] || rawUnit.slice(0, 3);
      const displayText = num + (abbrev ? " " + abbrev : "");

      const baseY = uniqueHookStats.length === 1 ? 42 : (si === 0 ? 32 : 52);

      elements.push({
        type: "text",
        track: hookStatTrack,
        time: 0.1,
        duration: 2,
        text: displayText,
        font_family: FONT,
        font_weight: "900",
        font_size: uniqueHookStats.length === 1 ? 120 : 72,
        fill_color: BRAND_GOLD,
        x_alignment: "50%",
        width: "85%",
        y: `${baseY}%`,
        shadow_color: "rgba(245,166,35,0.4)",
        shadow_blur: 50,
        animations: [
          { type: "scale", start_scale: "88%", duration: "25%", easing: "back-out" },
          { type: "fade", fade_type: "out", duration: "30%", start_time: "60%" },
        ],
      });
    }

    // Player name as sublabel at bottom of reveal
    if (script.playerName) {
      elements.push({
        type: "text",
        track: hookStatTrack,
        time: 0.3,
        duration: 1.7,
        text: script.playerName.toUpperCase(),
        font_family: FONT,
        font_weight: "400",
        font_size: 20,
        fill_color: "rgba(255,255,255,0.3)",
        x_alignment: "50%",
        width: "70%",
        y: uniqueHookStats.length === 1 ? "50%" : "60%",
        letter_spacing: "20%",
      });
    }
  }

  // ── Track 5: Caption text (word-by-word groups synced to voiceover) ──
  const captionTrack = trackCounter++;
  if (captionGroups && captionGroups.length > 0) {
    const isLastGroup = (idx) => idx === captionGroups.length - 1;

    for (let gi = 0; gi < captionGroups.length; gi++) {
      const group = captionGroups[gi];

      // Captions show from 0.0s — voiceover starts immediately

      // Skip captions that overlap with reveal segments
      const overlapsReveal = segs.some(seg =>
        isRevealSegment(seg) && group.start < seg.end && (group.start + group.duration) > seg.start
      );
      if (overlapsReveal) continue;

      // ── REGULAR CAPTIONS ──
      // Last group (CTA/closing question): extend to end of video so viewers can read + engage
      const duration = isLastGroup(gi)
        ? Math.max(totalDuration - group.start, group.duration, 5)
        : group.duration;

      // Full sentence as one element — gold if it has emphasis words, white otherwise
      elements.push({
        type: "text",
        track: captionTrack,
        time: group.start,
        duration: duration,
        text: group.text,
        font_family: FONT,
        font_weight: "800",
        font_size: 48,
        fill_color: group.hasEmphasis ? BRAND_GOLD : "#ffffff",
        x_alignment: "50%",
        width: "70%",
        x: "43%",
        y: "42%",
        shadow_color: "rgba(0,0,0,1)",
        shadow_blur: 16,
        line_height: "135%",
      });
    }
  } else {
    // Fallback: segment-based captions if no word-by-word data
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const duration = seg.end - seg.start;
      if (duration <= 0 || !seg.text || isRevealSegment(seg)) continue;

      elements.push({
        type: "text",
        track: captionTrack,
        time: seg.start,
        duration: duration,
        text: seg.text,
        font_family: FONT,
        font_weight: "800",
        font_size: 48,
        fill_color: "#ffffff",
        x_alignment: "50%",
        width: "70%",
        y: "42%",
        shadow_color: "rgba(0,0,0,1)",
        shadow_blur: 16,
        line_height: "135%",
        animations: [
          { type: "fade", fade_type: "in", duration: "8%" },
        ],
      });
    }
  }

  // ── Track 6: Reveal overlays (stat numbers or quote text + decorative lines) ──
  const revealTrack = trackCounter++;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const duration = seg.end - seg.start;
    if (duration <= 0 || !isRevealSegment(seg)) continue;

    const displayText = (seg.text || "").trim();

    // Top decorative gold line
    elements.push({
      type: "shape",
      track: revealTrack,
      time: seg.start,
      duration: duration,
      width: WIDTH - 96,
      height: 1,
      x: WIDTH / 2,
      y: 100,
      fill_color: "rgba(245,166,35,0.5)",
      animations: [
        { type: "fade", fade_type: "in", duration: "15%" },
      ],
    });

    // Bottom decorative gold line
    elements.push({
      type: "shape",
      track: revealTrack,
      time: seg.start,
      duration: duration,
      width: WIDTH - 96,
      height: 1,
      x: WIDTH / 2,
      y: HEIGHT - 220,
      fill_color: "rgba(245,166,35,0.5)",
      animations: [
        { type: "fade", fade_type: "in", duration: "15%" },
      ],
    });

    // Eyebrow text (segment name)
    if (seg.name) {
      elements.push({
        type: "text",
        track: revealTrack,
        time: seg.start,
        duration: duration,
        text: seg.name.toUpperCase(),
        font_family: FONT,
        font_weight: "700",
        font_size: 22,
        fill_color: "rgba(245,166,35,0.65)",
        x_alignment: "50%",
        width: "60%",
        y: "38%",
        letter_spacing: "30%",
        animations: [
          { type: "fade", fade_type: "in", duration: "15%" },
          { type: "slide", direction: "up", distance: "1%", duration: "20%" },
        ],
      });
    }

    // Main content — stat or quote
    if (isStatReveal(displayText)) {
      const { number, unit, sublabel } = parseStatText(displayText);

      // Big gold number
      elements.push({
        type: "text",
        track: revealTrack,
        time: seg.start,
        duration: duration,
        text: number,
        font_family: FONT,
        font_weight: "900",
        font_size: 160,
        fill_color: BRAND_GOLD,
        x_alignment: "50%",
        width: "85%",
        y: "45%",
        shadow_color: "rgba(245,166,35,0.4)",
        shadow_blur: 50,
        animations: [
          { type: "scale", start_scale: "88%", duration: "20%", easing: "back-out" },
          { type: "fade", fade_type: "in", duration: "10%" },
        ],
      });

      // Unit label below number
      if (unit) {
        elements.push({
          type: "text",
          track: revealTrack,
          time: seg.start,
          duration: duration,
          text: unit.toUpperCase(),
          font_family: FONT,
          font_weight: "700",
          font_size: 36,
          fill_color: "rgba(245,166,35,0.5)",
          x_alignment: "50%",
          width: "60%",
          y: "52%",
          letter_spacing: "30%",
        });
      }

      // Sublabel (e.g. "ABA Champion · MVP")
      if (sublabel) {
        elements.push({
          type: "text",
          track: revealTrack,
          time: seg.start,
          duration: duration,
          text: sublabel,
          font_family: FONT,
          font_weight: "400",
          font_size: 20,
          fill_color: "rgba(255,255,255,0.3)",
          x_alignment: "50%",
          width: "70%",
          y: "56%",
          letter_spacing: "20%",
        });
      }
    } else {
      // Quote reveal — bright white uppercase text with strong shadow
      elements.push({
        type: "text",
        track: revealTrack,
        time: seg.start,
        duration: duration,
        text: displayText.toUpperCase(),
        font_family: FONT,
        font_weight: "900",
        font_size: 48,
        fill_color: "#ffffff",
        x_alignment: "50%",
        width: "80%",
        y: "42%",
        line_height: "140%",
        letter_spacing: "5%",
        shadow_color: "rgba(0,0,0,1)",
        shadow_blur: 20,
        animations: [
          { type: "scale", start_scale: "88%", duration: "20%", easing: "back-out" },
          { type: "fade", fade_type: "in", duration: "10%" },
        ],
      });
    }

    // Attribution text below (only if provided)
    if (seg.attribution) {
      elements.push({
        type: "text",
        track: revealTrack,
        time: seg.start,
        duration: duration,
        text: seg.attribution,
        font_family: FONT,
        font_weight: "600",
        font_size: 18,
        fill_color: "rgba(245,166,35,0.45)",
        x_alignment: "50%",
        width: "60%",
        y: "62%",
        letter_spacing: "25%",
        animations: [
          { type: "fade", fade_type: "in", duration: "20%", start_time: "30%" },
        ],
      });
    }
  }

  // ── Mid-video stat reveals: detect key stats in captions and show as brief reveals ──
  // Scans caption groups for significant stat patterns and inserts 2s reveal overlays
  const revealDimTrack = trackCounter++;
  const revealContentTrack = trackCounter++;
  const STAT_RE = /(\d[\d,.]+)\s*(points?|pts?|rebounds?|reb|assists?|ast|blocks?|blk|shots?|steals?|stl|ppg|rpg|apg|bpg|%)/gi;
  let lastRevealEnd = hookEndTime; // don't stack reveals too close together

  if (captionGroups && captionGroups.length > 0) {
    for (const group of captionGroups) {
      if (group.start < hookEndTime + 5) continue; // skip early captions
      if (group.start < lastRevealEnd + 8) continue; // min 8s gap between reveals

      const matches = group.text.match(STAT_RE);
      if (!matches || matches.length === 0) continue;

      // Only reveal for the first stat match in this group
      const stat = matches[0].trim().toUpperCase();
      const parts = stat.match(/^([\d,.]+)\s*(.*)/);
      const num = parts ? parts[1] : stat;
      const rawUnit = parts ? parts[2] : "";
      const ABBREV = { POINTS:"PTS", POINT:"PTS", REBOUNDS:"REB", REBOUND:"REB", BLOCKS:"BLK", BLOCK:"BLK", SHOTS:"BLK", ASSISTS:"AST", STEALS:"STL" };
      const unit = ABBREV[rawUnit] || rawUnit.slice(0, 3);
      const displayText = num + " " + unit;

      const revealStart = group.start;
      const revealDur = 2.2;
      lastRevealEnd = revealStart + revealDur;

      // Dim overlay
      elements.push({
        type: "shape",
        track: revealDimTrack,
        time: revealStart,
        duration: revealDur,
        width: WIDTH,
        height: HEIGHT,
        x: WIDTH / 2,
        y: HEIGHT / 2,
        fill_color: "rgba(0,0,0,0.7)",
        animations: [
          { type: "fade", fade_type: "in", duration: "10%" },
          { type: "fade", fade_type: "out", duration: "15%", start_time: "80%" },
        ],
      });

      // Big gold stat
      elements.push({
        type: "text",
        track: revealContentTrack,
        time: revealStart,
        duration: revealDur,
        text: displayText,
        font_family: FONT,
        font_weight: "900",
        font_size: 90,
        fill_color: BRAND_GOLD,
        x_alignment: "50%",
        width: "85%",
        y: "42%",
        shadow_color: "rgba(245,166,35,0.4)",
        shadow_blur: 50,
        animations: [
          { type: "scale", start_scale: "88%", duration: "20%", easing: "back-out" },
          { type: "fade", fade_type: "out", duration: "15%", start_time: "80%" },
        ],
      });

      // Top gold line
      elements.push({
        type: "shape",
        track: revealContentTrack,
        time: revealStart,
        duration: revealDur,
        width: WIDTH - 96,
        height: 1,
        x: WIDTH / 2,
        y: 100,
        fill_color: "rgba(245,166,35,0.5)",
      });

      // Bottom gold line
      elements.push({
        type: "shape",
        track: revealContentTrack,
        time: revealStart,
        duration: revealDur,
        width: WIDTH - 96,
        height: 1,
        x: WIDTH / 2,
        y: HEIGHT - 220,
        fill_color: "rgba(245,166,35,0.5)",
      });
    }
  }

  // ── Track 7: Player name lower third (appears after hook) ──
  const lowerThirdTrack = trackCounter++;
  const hookEnd = segs.length > 0 ? segs[0].end : 3;
  const playerName = script.playerName || "";
  const storyLabel = (template.name || script.storyType || "").toUpperCase();

  if (playerName) {
    const ltDuration = totalDuration - hookEnd;

    // Eyebrow label (story type) — left-aligned using center positioning
    elements.push({
      type: "text",
      track: lowerThirdTrack,
      time: hookEnd,
      duration: ltDuration,
      text: "— " + storyLabel,
      font_family: FONT,
      font_weight: "700",
      font_size: 22,
      fill_color: BRAND_GOLD,
      x_alignment: "50%",
      width: "45%",
      x: "25%",
      y: "66%",
      letter_spacing: "20%",
      shadow_color: "rgba(0,0,0,1)",
      shadow_blur: 8,
      animations: [
        { type: "fade", fade_type: "in", duration: "8%" },
      ],
    });

    // Player name text
    elements.push({
      type: "text",
      track: lowerThirdTrack,
      time: hookEnd,
      duration: ltDuration,
      text: playerName.toUpperCase(),
      font_family: FONT,
      font_weight: "900",
      font_size: 40,
      fill_color: "#ffffff",
      x_alignment: "50%",
      width: "45%",
      x: "25%",
      y: "69%",
      shadow_color: "rgba(0,0,0,1)",
      shadow_blur: 12,
      animations: [
        { type: "fade", fade_type: "in", duration: "8%" },
      ],
    });
  }

  // ── Player portrait photo (small image bottom-left, above lower third) ──
  const playerPhotoUrl = script.playerPhotoUrl || "";
  if (playerPhotoUrl && playerName) {
    const portraitTrack = trackCounter++;
    // Gold border frame — positioned above the lower third text
    elements.push({
      type: "shape",
      track: portraitTrack,
      time: hookEnd,
      duration: totalDuration - hookEnd,
      width: 140,
      height: 170,
      x: "13%",
      y: "56%",
      fill_color: "rgba(245,166,35,0.3)",
      border_radius: "5%",
      animations: [
        { type: "fade", fade_type: "in", duration: "10%" },
      ],
    });
    // Player photo
    elements.push({
      type: "image",
      track: portraitTrack,
      time: hookEnd,
      duration: totalDuration - hookEnd,
      source: playerPhotoUrl,
      width: 130,
      height: 160,
      x: "13%",
      y: "56%",
      fit: "cover",
      border_radius: "4%",
      animations: [
        { type: "fade", fade_type: "in", duration: "10%" },
        { type: "scale", start_scale: "100%", end_scale: "108%", duration: "100%" },
      ],
    });
  }

  // Phase badge removed — internal phase names not viewer-facing

  // ── Track 9: Logo watermark "Sports Lore" top-left ──
  const uiTrack = trackCounter++;
  elements.push({
    type: "text",
    track: uiTrack,
    time: 0,
    duration: totalDuration,
    text: "SPORTS LORE",
    font_family: FONT,
    font_weight: "800",
    font_size: 22,
    fill_color: "rgba(245,166,35,0.7)",
    background_color: "rgba(0,0,0,0.4)",
    background_x_padding: "25%",
    background_y_padding: "15%",
    background_border_radius: "6%",
    x_alignment: "50%",
    width: 250,
    x: "12%",
    y: "3%",
    letter_spacing: "20%",
  });

  // ── (same Track 9): @SportsLore1 watermark bottom-right ──
  elements.push({
    type: "text",
    track: uiTrack,
    time: 0,
    duration: totalDuration,
    text: "@SportsLore1",
    font_family: FONT,
    font_weight: "600",
    font_size: 18,
    fill_color: "rgba(255,255,255,0.3)",
    x_alignment: "100%",
    width: 250,
    height: 30,
    x: "87%",
    y: "94%",
  });

  // ── Track 10: Progress bar at bottom ──
  const progressTrack = trackCounter++;
  elements.push({
    type: "shape",
    track: progressTrack,
    time: 0,
    duration: totalDuration,

    width: WIDTH,
    height: 6,
    x: WIDTH / 2,
    y: HEIGHT - 3,
    fill_color: "rgba(255,255,255,0.06)",
  });
  // Animated fill bar
  elements.push({
    type: "shape",
    track: progressTrack,
    time: 0,
    duration: totalDuration,

    width: WIDTH,
    height: 6,
    x: WIDTH / 2,
    y: HEIGHT - 3,
    fill_color: BRAND_GOLD,
    animations: [
      { type: "wipe", wipe_direction: "right", duration: "100%" },
    ],
  });

  // ── Track 11: Voiceover audio ──
  const voTrack = trackCounter++;
  if (voiceoverUrl) {
    elements.push({
      type: "audio",
      track: voTrack,
      time: 0,
      source: voiceoverUrl,
      volume: "100%",
      // No duration constraint — plays to natural audio length
    });
  }

  // ── Track 12: Background music (single continuous element, no loop) ──
  const musicTrack = trackCounter++;
  if (musicTrackUrl) {
    elements.push({
      type: "audio",
      track: musicTrack,
      time: hookEnd, // start after hook (silent hook, voice only)
      source: musicTrackUrl,
      volume: "10%",
      loop: false,
      animations: [
        { type: "fade", fade_type: "in", duration: "8%" },
      ],
    });
  }

  return {
    output_format: "mp4",
    width: WIDTH,
    height: HEIGHT,
    duration: totalDuration,
    frame_rate: 30,
    elements: elements,
  };
}

/**
 * Split the full script text into segments based on story template timing.
 * Distributes sentences across segments proportionally to their duration.
 *
 * @param {Object} script - The script object with .script, .hookLine, etc.
 * @param {Array} templateSegments - From getStoryTemplate().segments
 * @returns {Array} segments with {start, end, name, text, type}
 */
function buildSegmentsFromScript(script, templateSegments) {
  const fullText = script.hookLine
    ? script.hookLine + ". " + (script.script || "")
    : (script.script || "");

  // Split into sentences
  const sentences = fullText
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return templateSegments.map(seg => ({
      start: seg.start,
      end: seg.end,
      name: seg.name,
      text: "",
      type: isRevealSegment(seg) ? "reveal" : "footage",
    }));
  }

  // Calculate total duration for proportional distribution
  const totalDuration = templateSegments.reduce((sum, s) => sum + (s.end - s.start), 0);
  const results = [];
  let sentenceIdx = 0;

  for (const seg of templateSegments) {
    const segDuration = seg.end - seg.start;
    // Allocate sentences proportionally (at least 1 per segment if available)
    const proportion = segDuration / totalDuration;
    let numSentences = Math.max(1, Math.round(proportion * sentences.length));

    // Don't exceed remaining sentences
    const remaining = sentences.length - sentenceIdx;
    numSentences = Math.min(numSentences, remaining);

    const segSentences = sentences.slice(sentenceIdx, sentenceIdx + numSentences);
    sentenceIdx += numSentences;

    results.push({
      start: seg.start,
      end: seg.end,
      name: seg.name,
      text: segSentences.join(" "),
      clipCategory: seg.clipCategory,
      type: isRevealSegment({ name: seg.name, clipCategory: seg.clipCategory }) ? "reveal" : "footage",
    });
  }

  // If any sentences remain, append to the last segment
  if (sentenceIdx < sentences.length) {
    const last = results[results.length - 1];
    const extra = sentences.slice(sentenceIdx).join(" ");
    last.text = last.text ? last.text + " " + extra : extra;
  }

  return results;
}

module.exports = { composeVideo, buildSegmentsFromScript };
