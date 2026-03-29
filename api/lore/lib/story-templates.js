/**
 * api/lore/lib/story-templates.js
 * Story flow templates that define pacing, segment structure, and retention hooks
 * for each story type. Based on research into highest-retention YouTube Shorts formats.
 *
 * Each template defines:
 *   - segments: named timeline segments with start/end times and clip pacing
 *   - retentionHooks: timestamps where the script must include a "second hook"
 *   - musicShift: timestamp where music mood should change (dual-track)
 *   - clipCategories: what types of clips to source for each segment
 */

// Segment pacing: cut frequency varies by story phase
// "fast" = 1.5s cuts, "medium" = 2-2.5s cuts, "slow" = 3-4s holds
const PACING = { fast: 1.5, medium: 2.25, slow: 3.5 };

const STORY_TEMPLATES = {
  // ── Tragic stories: career-ending injuries, fall from grace ──
  forgotten_legend: {
    name: "Forgotten Legend",
    segments: [
      { name: "hook",       start: 0,  end: 3,  pacing: "fast",   clipCategory: "action",     description: "Show peak moment + shocking contrast" },
      { name: "greatness",  start: 3,  end: 12, pacing: "medium", clipCategory: "action",     description: "Who they were, highlight reel" },
      { name: "context",    start: 12, end: 20, pacing: "medium", clipCategory: "era",        description: "The era, the team, why it mattered" },
      { name: "turn",       start: 20, end: 32, pacing: "slow",   clipCategory: "atmosphere", description: "What went wrong / why they were forgotten" },
      { name: "forgotten",  start: 32, end: 45, pacing: "medium", clipCategory: "stadium",    description: "The aftermath, what was lost" },
      { name: "legacy",     start: 45, end: 52, pacing: "medium", clipCategory: "stats",      description: "Their lasting impact or final stats" },
      { name: "kicker",     start: 52, end: 55, pacing: "fast",   clipCategory: "reaction",   description: "One final gut-punch fact" },
    ],
    retentionHooks: [
      { time: 10, type: "escalation", prompt: "Insert a line like 'But that's not even the craziest part' or 'And then it got worse'" },
      { time: 30, type: "twist", prompt: "Insert a tonal shift: reveal the turn, the moment everything changed" },
    ],
    musicShift: { time: 20, fromMood: "nostalgic", toMood: "melancholy" },
    musicMoods: { primary: "nostalgic", secondary: "melancholy" },
  },

  // ── Trending callback: current news tied to history ──
  trending_callback: {
    name: "Trending Callback",
    segments: [
      { name: "hook",       start: 0,  end: 3,  pacing: "fast",   clipCategory: "action",   description: "Current event clip or headline" },
      { name: "current",    start: 3,  end: 12, pacing: "fast",   clipCategory: "action",   description: "What's happening now" },
      { name: "bridge",     start: 12, end: 18, pacing: "medium", clipCategory: "era",      description: "Connect to historical parallel" },
      { name: "history",    start: 18, end: 35, pacing: "medium", clipCategory: "action",   description: "The historical story" },
      { name: "parallel",   start: 35, end: 48, pacing: "medium", clipCategory: "stats",    description: "Draw the comparison, show the stats" },
      { name: "payoff",     start: 48, end: 55, pacing: "fast",   clipCategory: "reaction", description: "Why it matters, what to watch for" },
    ],
    retentionHooks: [
      { time: 10, type: "question", prompt: "Insert a question: 'But did you know this has happened before?'" },
      { time: 30, type: "escalation", prompt: "Insert: 'And the similarities are eerie' or 'History might be repeating itself'" },
    ],
    musicShift: { time: 12, fromMood: "hype", toMood: "dramatic" },
    musicMoods: { primary: "hype", secondary: "dramatic" },
  },

  // ── What-if scenarios ──
  what_if: {
    name: "What If",
    segments: [
      { name: "hook",       start: 0,  end: 3,  pacing: "fast",   clipCategory: "action",     description: "The provocative question" },
      { name: "setup",      start: 3,  end: 15, pacing: "medium", clipCategory: "action",     description: "What actually happened" },
      { name: "diverge",    start: 15, end: 25, pacing: "slow",   clipCategory: "atmosphere", description: "The moment things could have gone differently" },
      { name: "alternate",  start: 25, end: 42, pacing: "medium", clipCategory: "stats",      description: "What would have changed" },
      { name: "ripple",     start: 42, end: 52, pacing: "fast",   clipCategory: "reaction",   description: "Butterfly effects on the whole sport" },
      { name: "verdict",    start: 52, end: 55, pacing: "fast",   clipCategory: "atmosphere", description: "Final thought-provoking line" },
    ],
    retentionHooks: [
      { time: 10, type: "question", prompt: "Insert: 'But what if it had gone the other way?'" },
      { time: 30, type: "escalation", prompt: "Insert: 'And the ripple effects would have been insane'" },
    ],
    musicShift: { time: 15, fromMood: "mysterious", toMood: "epic" },
    musicMoods: { primary: "mysterious", secondary: "epic" },
  },

  // ── Rivalry stories ──
  rivalry: {
    name: "Rivalry",
    segments: [
      { name: "hook",       start: 0,  end: 3,  pacing: "fast",   clipCategory: "action",   description: "The defining moment or provocative claim" },
      { name: "fighter1",   start: 3,  end: 13, pacing: "fast",   clipCategory: "action",   description: "First competitor highlight reel + key stat" },
      { name: "fighter2",   start: 13, end: 23, pacing: "fast",   clipCategory: "action",   description: "Second competitor highlight reel + key stat" },
      { name: "collision",  start: 23, end: 40, pacing: "medium", clipCategory: "action",   description: "The matchups, the battles, the moments" },
      { name: "verdict",    start: 40, end: 50, pacing: "slow",   clipCategory: "stats",    description: "Who won, the defining stat" },
      { name: "legacy",     start: 50, end: 55, pacing: "fast",   clipCategory: "reaction", description: "What the rivalry meant" },
    ],
    retentionHooks: [
      { time: 10, type: "contrast", prompt: "Insert comparison: 'But his rival was just as dangerous'" },
      { time: 30, type: "escalation", prompt: "Insert: 'And then came the game that settled it forever'" },
    ],
    musicShift: { time: 23, fromMood: "intense", toMood: "epic" },
    musicMoods: { primary: "intense", secondary: "epic" },
  },

  // ── Record breakers ──
  record_breaker: {
    name: "Record Breaker",
    segments: [
      { name: "hook",       start: 0,  end: 3,  pacing: "fast",   clipCategory: "stats",      description: "The record as a giant number on screen" },
      { name: "context",    start: 3,  end: 12, pacing: "medium", clipCategory: "action",     description: "Why this record is insane (comparisons)" },
      { name: "story",      start: 12, end: 30, pacing: "medium", clipCategory: "action",     description: "The game/moment/season it happened" },
      { name: "attempts",   start: 30, end: 42, pacing: "fast",   clipCategory: "action",     description: "Who came close to breaking it" },
      { name: "stands",     start: 42, end: 52, pacing: "slow",   clipCategory: "atmosphere", description: "Why it still stands (or how it was broken)" },
      { name: "final",      start: 52, end: 55, pacing: "fast",   clipCategory: "stats",      description: "Will we ever see this again?" },
    ],
    retentionHooks: [
      { time: 10, type: "escalation", prompt: "Insert: 'And no one has even come close since'" },
      { time: 30, type: "question", prompt: "Insert: 'So who came the closest to breaking it?'" },
    ],
    musicShift: { time: 30, fromMood: "epic", toMood: "dramatic" },
    musicMoods: { primary: "epic", secondary: "dramatic" },
  },

  // ── Comeback stories ──
  comeback: {
    name: "Comeback",
    segments: [
      { name: "hook",       start: 0,  end: 3,  pacing: "fast",   clipCategory: "action",     description: "The triumphant return OR the lowest moment" },
      { name: "fall",       start: 3,  end: 12, pacing: "medium", clipCategory: "action",     description: "What went wrong" },
      { name: "bottom",     start: 12, end: 20, pacing: "slow",   clipCategory: "atmosphere", description: "How bad it got (specific details)" },
      { name: "climb",      start: 20, end: 38, pacing: "medium", clipCategory: "action",     description: "The work, the grind, the turning point" },
      { name: "payoff",     start: 38, end: 50, pacing: "fast",   clipCategory: "reaction",   description: "The big moment, the win, the return" },
      { name: "legacy",     start: 50, end: 55, pacing: "fast",   clipCategory: "stats",      description: "What it meant, one powerful stat" },
    ],
    retentionHooks: [
      { time: 10, type: "escalation", prompt: "Insert: 'And it only got worse from there'" },
      { time: 30, type: "twist", prompt: "Insert: 'But then something changed' — the turning point" },
    ],
    musicShift: { time: 20, fromMood: "melancholy", toMood: "inspiring" },
    musicMoods: { primary: "melancholy", secondary: "inspiring" },
  },

  // ── Scandal stories ──
  scandal: {
    name: "Scandal",
    segments: [
      { name: "hook",       start: 0,  end: 3,  pacing: "fast",   clipCategory: "reaction",   description: "The shocking reveal or accusation" },
      { name: "setup",      start: 3,  end: 15, pacing: "medium", clipCategory: "action",     description: "Who they were before the scandal" },
      { name: "unravel",    start: 15, end: 30, pacing: "medium", clipCategory: "atmosphere", description: "How it came to light" },
      { name: "fallout",    start: 30, end: 45, pacing: "slow",   clipCategory: "reaction",   description: "Consequences, bans, public reaction" },
      { name: "aftermath",  start: 45, end: 52, pacing: "medium", clipCategory: "stats",      description: "Where they are now" },
      { name: "kicker",     start: 52, end: 55, pacing: "fast",   clipCategory: "atmosphere", description: "One final twist or ironic fact" },
    ],
    retentionHooks: [
      { time: 10, type: "escalation", prompt: "Insert: 'But what they found was way worse than anyone expected'" },
      { time: 30, type: "twist", prompt: "Insert: 'And that's when the cover-up unraveled'" },
    ],
    musicShift: { time: 15, fromMood: "dark", toMood: "intense" },
    musicMoods: { primary: "dark", secondary: "intense" },
  },

  // ── Draft bust stories ──
  draft_bust: {
    name: "Draft Bust",
    segments: [
      { name: "hook",       start: 0,  end: 3,  pacing: "fast",   clipCategory: "stats",      description: "The draft pick number + expectation vs reality" },
      { name: "hype",       start: 3,  end: 15, pacing: "fast",   clipCategory: "action",     description: "The pre-draft hype, college highlights" },
      { name: "draft",      start: 15, end: 22, pacing: "slow",   clipCategory: "reaction",   description: "Draft night moment" },
      { name: "struggle",   start: 22, end: 38, pacing: "medium", clipCategory: "action",     description: "What went wrong in the pros" },
      { name: "comparison", start: 38, end: 48, pacing: "fast",   clipCategory: "stats",      description: "Who was picked after them that became a star" },
      { name: "legacy",     start: 48, end: 55, pacing: "medium", clipCategory: "atmosphere", description: "Where are they now" },
    ],
    retentionHooks: [
      { time: 10, type: "contrast", prompt: "Insert: 'Everyone thought he was the next [legend]'" },
      { time: 30, type: "escalation", prompt: "Insert: 'And the player picked right after him? [star name]'" },
    ],
    musicShift: { time: 22, fromMood: "hype", toMood: "melancholy" },
    musicMoods: { primary: "hype", secondary: "melancholy" },
  },

  // ── Underdog stories ──
  underdog: {
    name: "Underdog",
    segments: [
      { name: "hook",       start: 0,  end: 3,  pacing: "fast",   clipCategory: "action",     description: "The impossible odds or the triumphant moment" },
      { name: "odds",       start: 3,  end: 12, pacing: "medium", clipCategory: "stats",      description: "Why nobody gave them a chance" },
      { name: "struggle",   start: 12, end: 22, pacing: "slow",   clipCategory: "atmosphere", description: "The challenges they faced" },
      { name: "belief",     start: 22, end: 32, pacing: "medium", clipCategory: "action",     description: "The moment they started believing" },
      { name: "run",        start: 32, end: 45, pacing: "fast",   clipCategory: "action",     description: "The improbable run" },
      { name: "triumph",    start: 45, end: 52, pacing: "fast",   clipCategory: "reaction",   description: "The final moment of triumph" },
      { name: "legacy",     start: 52, end: 55, pacing: "fast",   clipCategory: "stats",      description: "What it meant for the sport" },
    ],
    retentionHooks: [
      { time: 10, type: "contrast", prompt: "Insert: 'Vegas gave them a 500-to-1 chance' or similar impossible odds" },
      { time: 30, type: "twist", prompt: "Insert: 'And then the impossible started happening'" },
    ],
    musicShift: { time: 22, fromMood: "melancholy", toMood: "inspiring" },
    musicMoods: { primary: "melancholy", secondary: "inspiring" },
  },

  // ── GOAT debate stories ──
  goat_debate: {
    name: "GOAT Debate",
    segments: [
      { name: "hook",       start: 0,  end: 3,  pacing: "fast",   clipCategory: "action",   description: "Provocative claim or question" },
      { name: "case1",      start: 3,  end: 18, pacing: "fast",   clipCategory: "action",   description: "Case for player 1 — highlights + stats" },
      { name: "case2",      start: 18, end: 33, pacing: "fast",   clipCategory: "action",   description: "Case for player 2 — highlights + stats" },
      { name: "head2head",  start: 33, end: 45, pacing: "medium", clipCategory: "stats",    description: "Direct comparison, head-to-head stats" },
      { name: "verdict",    start: 45, end: 52, pacing: "slow",   clipCategory: "reaction", description: "The argument, the decisive factor" },
      { name: "question",   start: 52, end: 55, pacing: "fast",   clipCategory: "action",   description: "Throw it to the audience" },
    ],
    retentionHooks: [
      { time: 10, type: "contrast", prompt: "Insert: 'But his numbers don't tell the whole story'" },
      { time: 30, type: "question", prompt: "Insert: 'So when you put them side by side...' — build to the comparison" },
    ],
    musicShift: { time: 18, fromMood: "intense", toMood: "epic" },
    musicMoods: { primary: "intense", secondary: "epic" },
  },
};

// Default template for unrecognized story types
STORY_TEMPLATES.default = STORY_TEMPLATES.forgotten_legend;

/**
 * Get the story template for a given story type.
 */
function getStoryTemplate(storyType) {
  return STORY_TEMPLATES[storyType] || STORY_TEMPLATES.default;
}

/**
 * Calculate how many clips are needed for a template based on pacing.
 * Returns an array of { start, duration, clipCategory, segmentName }.
 */
function calculateClipSlots(storyType) {
  const template = getStoryTemplate(storyType);
  const slots = [];

  for (const segment of template.segments) {
    const segDuration = segment.end - segment.start;
    const cutDuration = PACING[segment.pacing];
    const numClips = Math.ceil(segDuration / cutDuration);

    for (let i = 0; i < numClips; i++) {
      const clipStart = segment.start + (i * cutDuration);
      const clipEnd = Math.min(clipStart + cutDuration, segment.end);
      if (clipEnd > clipStart) {
        slots.push({
          start: Math.round(clipStart * 10) / 10,
          duration: Math.round((clipEnd - clipStart) * 10) / 10,
          clipCategory: segment.clipCategory,
          segmentName: segment.name,
          segmentDescription: segment.description,
        });
      }
    }
  }

  return slots;
}

module.exports = {
  STORY_TEMPLATES, PACING,
  getStoryTemplate, calculateClipSlots,
};
