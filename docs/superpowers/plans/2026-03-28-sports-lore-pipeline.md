# Sports Lore — Full Production Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 15 Sports Lore YouTube Shorts pipeline features as Vercel serverless functions, using the existing KV store for state and Claude API for AI tasks.

**Architecture:** New `api/lore/` directory houses all Sports Lore endpoints. Shared utilities in `api/lore/lib/`. Each feature is a standalone serverless function following the existing pattern (CommonJS exports, KV for storage, Claude for AI). Cron triggers in `vercel.json` drive scheduled workflows. Google Sheets is replaced by Vercel KV (matching the existing codebase pattern) with structured JSON schemas.

**Tech Stack:** Node.js 18+, Vercel Functions, Vercel KV, Anthropic Claude API, YouTube Data/Analytics API, Creatomate API, ElevenLabs API, TikTok Content Posting API, Instagram Graph API, Mubert API (optional), Axios, FFmpeg (fallback only)

**Spec:** `docs/superpowers/specs/2026-03-27-sports-lore-production-improvements.md` + `c:\Users\justi\Downloads\2026-03-27-sports-lore-production-improvements.md`

---

## File Structure

```
api/
├── lore/
│   ├── lib/
│   │   ├── kv-lore.js          # KV helpers with Sports Lore key prefixes + schemas
│   │   ├── claude.js            # Claude API wrapper for Sports Lore prompts
│   │   ├── utils.js             # Shared utilities (getISOWeek, getEasternHour, etc.)
│   │   ├── youtube-api.js       # YouTube Data + Analytics API client
│   │   ├── creatomate.js        # Creatomate render + thumbnail API client
│   │   ├── elevenlabs.js        # ElevenLabs TTS API client
│   │   ├── music.js             # Music mood mapping + Mubert/library selection
│   │   ├── cross-post.js        # TikTok + Instagram API clients
│   │   └── post-times.js        # Sport-based posting schedule lookup
│   │
│   ├── weekly-batch.js          # Orchestrator: story selection + script gen + metadata
│   ├── generate-metadata.js     # Feature #1: titles, descriptions, hashtags, hook
│   ├── optimize-hook.js         # Feature #7: dedicated hook optimizer
│   ├── generate-thumbnail.js    # Feature #2: Creatomate thumbnail render
│   ├── clip-sourcer.js          # Feature #5: parallel clip sourcing
│   ├── clip-feedback.js         # Feature #3: rejection webhook
│   ├── batch-control.js         # Feature #4: pause/resume batch
│   ├── video-production.js      # Render pipeline: voiceover + music + video + upload
│   ├── select-music.js          # Feature #15: music mood selection + generation
│   ├── analytics.js             # Feature #6: YouTube analytics pull + feedback
│   ├── ab-test.js               # Feature #8: title A/B tracking
│   ├── post-schedule.js         # Feature #9: optimal post time calculation
│   ├── cross-post.js            # Feature #10: TikTok + Instagram upload
│   ├── comments.js              # Feature #11: comment monitoring + reply suggestions
│   ├── performance-check.js     # Feature #12: underperformer detection + re-upload queue
│   ├── render-fallback.js       # Feature #13: FFmpeg fallback renderer
│   └── cron-lore.js             # Cron entry point for all scheduled Lore workflows
```

---

## Phase 1 — Core Pipeline (Highest Impact)

### Task 1: KV Storage Layer for Sports Lore

**Files:**
- Create: `api/lore/lib/kv-lore.js`

- [ ] **Step 1: Create KV helper with Sports Lore schemas and key prefixes**

```javascript
/**
 * api/lore/lib/kv-lore.js
 * KV storage helpers for Sports Lore pipeline data.
 * Uses the same Vercel KV as the main app via api/_kv.js
 *
 * Key Prefixes:
 *   lore:batch:{batchId}        — batch metadata (status, week, video count)
 *   lore:script:{rowId}         — individual script queue row
 *   lore:analytics:{weekOf}     — weekly analytics summary
 *   lore:reupload:{videoId}     — re-upload queue entry
 *   lore:music:used             — recently used music tracks
 *   lore:rejections:patterns    — aggregated clip rejection patterns
 *   lore:published:{videoId}    — published video log entry
 */

const kv = require("../../_kv");

// --- Script Queue Row Schema ---
function newScriptRow(batchId, index, data = {}) {
  const rowId = `${batchId}-${index}`;
  return {
    rowId,
    batchId,
    scheduledDate: data.scheduledDate || null,
    playerName: data.playerName || "",
    playerSport: data.playerSport || "",
    storyType: data.storyType || "",
    script: data.script || "",
    hookLine: data.hookLine || "",
    hookPattern: data.hookPattern || "",
    titleA: data.titleA || "",
    titleB: data.titleB || "",
    titleUsed: data.titleUsed || "",
    description: data.description || "",
    hashtags: data.hashtags || [],
    searchTerms: data.searchTerms || "",
    clipBriefs: data.clipBriefs || [],
    status: data.status || "Pending",        // Pending → Ready → Produced → Paused
    clipsSourced: data.clipsSourced || 0,
    clipsRejected: data.clipsRejected || 0,
    rejectionReasons: data.rejectionReasons || [],
    clipSourceStatus: data.clipSourceStatus || "Pending",
    dateSourced: data.dateSourced || null,
    playerPhotoUrl: data.playerPhotoUrl || "",
    thumbnailUrl: data.thumbnailUrl || "",
    scheduledPostTime: data.scheduledPostTime || "",
    musicMood: data.musicMood || "",
    musicTrack: data.musicTrack || "",
    musicSource: data.musicSource || "",
    youtubeUrl: data.youtubeUrl || "",
    youtubeVideoId: data.youtubeVideoId || "",
    tiktokUrl: data.tiktokUrl || "",
    instagramUrl: data.instagramUrl || "",
    viewsAt48h: data.viewsAt48h || null,
    retentionAt48h: data.retentionAt48h || null,
  };
}

// --- Batch helpers ---
async function getBatch(batchId) {
  return kv.get(`lore:batch:${batchId}`);
}

async function saveBatch(batchId, data) {
  return kv.set(`lore:batch:${batchId}`, data, 86400 * 30); // 30 days
}

async function getScript(rowId) {
  return kv.get(`lore:script:${rowId}`);
}

async function saveScript(rowId, data) {
  return kv.set(`lore:script:${rowId}`, data, 86400 * 30);
}

async function getBatchScripts(batchId) {
  const batch = await getBatch(batchId);
  if (!batch || !batch.rowIds) return [];
  const scripts = await Promise.all(batch.rowIds.map(id => getScript(id)));
  return scripts.filter(Boolean);
}

// --- Analytics helpers ---
async function saveAnalytics(weekOf, data) {
  return kv.set(`lore:analytics:${weekOf}`, data, 86400 * 90); // 90 days
}

async function getAnalytics(weekOf) {
  return kv.get(`lore:analytics:${weekOf}`);
}

async function getRecentAnalytics(weeks = 4) {
  const results = [];
  const now = new Date();
  for (let i = 0; i < weeks; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const weekOf = d.toISOString().split("T")[0];
    const data = await getAnalytics(weekOf);
    if (data) results.push(data);
  }
  return results;
}

// --- Rejection patterns ---
async function getRejectionPatterns() {
  return (await kv.get("lore:rejections:patterns")) || {};
}

async function addRejection(rowId, reasons) {
  const patterns = await getRejectionPatterns();
  reasons.forEach(r => { patterns[r] = (patterns[r] || 0) + 1; });
  await kv.set("lore:rejections:patterns", patterns, 86400 * 30);
  // Also update the script row
  const script = await getScript(rowId);
  if (script) {
    script.clipsRejected = (script.clipsRejected || 0) + 1;
    script.rejectionReasons = [...new Set([...(script.rejectionReasons || []), ...reasons])];
    await saveScript(rowId, script);
  }
}

// --- Published log ---
async function savePublished(videoId, data) {
  return kv.set(`lore:published:${videoId}`, data, 86400 * 90);
}

async function getPublished(videoId) {
  return kv.get(`lore:published:${videoId}`);
}

// --- Re-upload queue ---
async function queueReupload(videoId, data) {
  return kv.set(`lore:reupload:${videoId}`, data, 86400 * 14);
}

async function getReupload(videoId) {
  return kv.get(`lore:reupload:${videoId}`);
}

// --- Music tracking ---
async function getRecentlyUsedTracks(count = 7) {
  return (await kv.get("lore:music:used")) || [];
}

async function trackMusicUsage(trackName) {
  const used = await getRecentlyUsedTracks();
  used.unshift(trackName);
  if (used.length > 20) used.length = 20;
  await kv.set("lore:music:used", used, 86400 * 30);
}

module.exports = {
  newScriptRow, getBatch, saveBatch, getScript, saveScript, getBatchScripts,
  saveAnalytics, getAnalytics, getRecentAnalytics,
  getRejectionPatterns, addRejection,
  savePublished, getPublished,
  queueReupload, getReupload,
  getRecentlyUsedTracks, trackMusicUsage,
};
```

- [ ] **Step 2: Commit**

```bash
git add api/lore/lib/kv-lore.js
git commit -m "feat(lore): add KV storage layer with script queue schema"
```

---

### Task 2: Claude API Wrapper for Sports Lore

**Files:**
- Create: `api/lore/lib/claude.js`

- [ ] **Step 1: Create Claude helper with structured JSON output**

```javascript
/**
 * api/lore/lib/claude.js
 * Claude API wrapper for Sports Lore AI tasks.
 * Handles: metadata generation, hook optimization, story selection,
 *          comment reply suggestions, re-upload analysis.
 */

const Anthropic = require("@anthropic-ai/sdk");

let _client;
function getClient() {
  if (!_client) _client = new Anthropic();
  return _client;
}

/**
 * Send a prompt to Claude and parse JSON response.
 * @param {string} prompt - The full prompt text
 * @param {object} opts - { model, maxTokens, system }
 * @returns {object} Parsed JSON from Claude's response
 */
async function askClaudeJSON(prompt, opts = {}) {
  const client = getClient();
  const model = opts.model || "claude-sonnet-4-5-20250514";
  const maxTokens = opts.maxTokens || 500;

  const messages = [{ role: "user", content: prompt }];
  const params = { model, max_tokens: maxTokens, messages };
  if (opts.system) params.system = opts.system;

  const response = await client.messages.create(params);
  const text = response.content[0]?.text || "";

  // Extract JSON from response (may be wrapped in ```json blocks)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) throw new Error("Claude did not return valid JSON: " + text.slice(0, 200));

  return JSON.parse(jsonMatch[1].trim());
}

/**
 * Send a prompt to Claude and return raw text.
 */
async function askClaude(prompt, opts = {}) {
  const client = getClient();
  const model = opts.model || "claude-sonnet-4-5-20250514";
  const maxTokens = opts.maxTokens || 1000;

  const messages = [{ role: "user", content: prompt }];
  const params = { model, max_tokens: maxTokens, messages };
  if (opts.system) params.system = opts.system;

  const response = await client.messages.create(params);
  return response.content[0]?.text || "";
}

module.exports = { askClaudeJSON, askClaude, getClient };
```

- [ ] **Step 2: Commit**

```bash
git add api/lore/lib/claude.js
git commit -m "feat(lore): add Claude API wrapper with JSON parsing"
```

---

### Task 2.5: Shared Utilities

**Files:**
- Create: `api/lore/lib/utils.js`

- [ ] **Step 1: Create shared utility functions**

```javascript
/**
 * api/lore/lib/utils.js
 * Shared utilities for Sports Lore pipeline.
 */

/**
 * Get ISO week number for a date.
 */
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

/**
 * Get batch ID for a given date (e.g., "2026-W14").
 */
function getBatchIdForDate(date) {
  const weekNum = getISOWeek(date);
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * Get current Eastern Time hour, accounting for EDT/EST.
 * EDT (UTC-4): March second Sunday – November first Sunday
 * EST (UTC-5): November first Sunday – March second Sunday
 */
function getEasternHour(date) {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  const isDST = date.getTimezoneOffset() < Math.max(jan, jul);
  // Fallback: compute from UTC
  const offset = isDST ? 4 : 5;
  return (date.getUTCHours() - offset + 24) % 24;
}

/**
 * Get Eastern timezone offset string (e.g., "-04:00" or "-05:00").
 */
function getEasternOffset(date) {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" });
  const parts = formatter.formatToParts(date);
  const tz = parts.find(p => p.type === "timeZoneName");
  // Returns "GMT-5" or "GMT-4" → convert to "-05:00" or "-04:00"
  const match = (tz?.value || "GMT-5").match(/GMT([+-]\d+)/);
  const hours = parseInt(match?.[1] || "-5");
  return `${hours < 0 ? "-" : "+"}${String(Math.abs(hours)).padStart(2, "0")}:00`;
}

module.exports = { getISOWeek, getBatchIdForDate, getEasternHour, getEasternOffset };
```

- [ ] **Step 2: Commit**

```bash
git add api/lore/lib/utils.js
git commit -m "feat(lore): add shared utilities (ISO week, Eastern time helpers)"
```

> **Note:** All files that previously had inline `getISOWeek` should instead use `require("./lib/utils")` or `require("../lib/utils")`. The code in subsequent tasks already uses this import.

---

### Task 3: Feature #1 — Title, Description & Hook Generation

**Files:**
- Create: `api/lore/generate-metadata.js`

- [ ] **Step 1: Create metadata generation endpoint**

```javascript
/**
 * api/lore/generate-metadata.js  →  POST /api/lore/generate-metadata
 * Feature #1: Generate title, description, hashtags, and hook line for a script.
 *
 * Body: { rowId } — reads script from KV, generates metadata, saves back
 * Auth: x-secret header
 */

const { askClaudeJSON } = require("./lib/claude");
const { getScript, saveScript } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId } = req.body || {};
  if (!rowId) return res.status(400).json({ error: "rowId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  const prompt = `You are a viral YouTube Shorts title expert for sports history content.

Given this script about ${script.playerName} (${script.storyType}):
${script.script}

Generate:
1. title_a: A curiosity-gap hook title (5-8 words, makes viewer NEED to know). Example: "The NBA Banned Him For Being Too Good"
2. title_b: A bold claim title (5-8 words). Example: "Nobody Remembers The Best Shooter Ever"
3. description: 2-3 sentences with keywords for YouTube SEO (include player name, team, era)
4. hashtags: 7 hashtags, mix of broad (#shorts #nba #basketball) and specific (#playername)
5. hook_line: The FIRST sentence of the script, rewritten to be maximum scroll-stopping. This is what the viewer hears in the first 2 seconds. Must be a surprising fact, bold claim, or provocative question.

Return JSON only:
{"title_a":"...","title_b":"...","description":"...","hashtags":["..."],"hook_line":"..."}`;

  const metadata = await askClaudeJSON(prompt, { maxTokens: 500 });

  script.titleA = metadata.title_a;
  script.titleB = metadata.title_b;
  script.description = metadata.description;
  script.hashtags = metadata.hashtags;
  script.hookLine = metadata.hook_line;

  await saveScript(rowId, script);

  return res.status(200).json({ ok: true, rowId, metadata });
};
```

- [ ] **Step 2: Commit**

```bash
git add api/lore/generate-metadata.js
git commit -m "feat(lore): add title/description/hook generation endpoint (#1)"
```

---

### Task 4: Feature #7 — Hook Optimization

**Files:**
- Create: `api/lore/optimize-hook.js`

- [ ] **Step 1: Create dedicated hook optimizer endpoint**

```javascript
/**
 * api/lore/optimize-hook.js  →  POST /api/lore/optimize-hook
 * Feature #7: Dedicated Claude node that ONLY optimizes the first 3 seconds.
 * Separate from metadata generation for focused hook quality.
 *
 * Body: { rowId }
 * Auth: x-secret header
 */

const { askClaudeJSON } = require("./lib/claude");
const { getScript, saveScript } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId } = req.body || {};
  if (!rowId) return res.status(400).json({ error: "rowId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  const prompt = `You are a YouTube Shorts retention expert. The first 3 seconds determine whether someone keeps watching.

Here is a script for a sports history Short about ${script.playerName}:
${script.script}

Rewrite ONLY the first 1-2 sentences (the hook). The rest stays exactly the same.

Requirements for the hook:
- Must create immediate curiosity (viewer NEEDS to know what happens next)
- Use one of these proven patterns:
  a) Shocking stat: "This man averaged 40 points and nobody remembers him"
  b) Bold claim: "The NBA literally changed its rules because of one player"
  c) Direct challenge: "You've never heard of the greatest passer in NBA history"
  d) Time pressure: "In 1986, one game changed basketball forever"
- Maximum 15 words
- No clickbait that the video doesn't deliver on
- The hook must connect to the actual story

Return JSON:
{"hook":"...","pattern_used":"shocking_stat|bold_claim|direct_challenge|time_pressure","original_first_line":"..."}`;

  const result = await askClaudeJSON(prompt, { maxTokens: 300 });

  script.hookLine = result.hook;
  script.hookPattern = result.pattern_used;

  await saveScript(rowId, script);

  return res.status(200).json({ ok: true, rowId, hook: result });
};
```

- [ ] **Step 2: Commit**

```bash
git add api/lore/optimize-hook.js
git commit -m "feat(lore): add dedicated hook optimization endpoint (#7)"
```

---

### Task 5: Feature #15 — Music Mood Selection & Generation

**Files:**
- Create: `api/lore/lib/music.js`
- Create: `api/lore/select-music.js`

- [ ] **Step 1: Create music mood mapping library**

```javascript
/**
 * api/lore/lib/music.js
 * Music mood mapping and selection logic for Sports Lore videos.
 * Maps story types → mood/energy/tempo/genre for background music.
 */

const MUSIC_MOOD_MAP = {
  forgotten_legend:  { mood: "nostalgic",  energy: "medium", tempo: "slow",   genre: "cinematic" },
  trending_callback: { mood: "hype",       energy: "high",   tempo: "fast",   genre: "trap" },
  what_if:           { mood: "mysterious",  energy: "medium", tempo: "medium", genre: "ambient" },
  rivalry:           { mood: "intense",     energy: "high",   tempo: "fast",   genre: "orchestral" },
  record_breaker:    { mood: "epic",        energy: "high",   tempo: "medium", genre: "cinematic" },
  comeback:          { mood: "inspiring",   energy: "rising", tempo: "builds", genre: "orchestral" },
  scandal:           { mood: "dark",        energy: "medium", tempo: "slow",   genre: "dark_ambient" },
  draft_bust:        { mood: "melancholy",  energy: "low",    tempo: "slow",   genre: "piano" },
  underdog:          { mood: "inspiring",   energy: "rising", tempo: "builds", genre: "cinematic" },
  goat_debate:       { mood: "intense",     energy: "high",   tempo: "fast",   genre: "trap" },
  default:           { mood: "dramatic",    energy: "medium", tempo: "medium", genre: "cinematic" },
};

// Audio mixing rules: music volume per phase (voiceover is always 100)
const AUDIO_MIX = {
  hook:   { start: 0,  end: 3,  musicVolume: 0 },
  build:  { start: 3,  end: 15, musicVolume: 20 },
  body:   { start: 15, end: 40, musicVolume: 25 },
  climax: { start: 40, end: 48, musicVolume: 40 },
  outro:  { start: 48, end: 55, musicVolume: 50 },
};

/**
 * Get mood profile for a story type, with script-based overrides.
 */
function getMoodForStory(storyType, scriptText = "") {
  const base = { ...(MUSIC_MOOD_MAP[storyType] || MUSIC_MOOD_MAP.default) };
  const lower = scriptText.toLowerCase();

  if (lower.includes("tragic") || lower.includes("died") || lower.includes("career-ending")) {
    base.mood = "melancholy";
    base.energy = "low";
    base.genre = "piano";
  }
  if (lower.includes("championship") || lower.includes("record") || lower.includes("greatest")) {
    base.mood = "epic";
    base.energy = "high";
    base.genre = "orchestral";
  }

  return base;
}

/**
 * Generate a track via Mubert API (if configured).
 * Returns { trackUrl, source: "mubert" } or null.
 */
async function generateMubertTrack(mood, duration = 55) {
  const pat = process.env.MUBERT_PAT;
  if (!pat) return null;

  const axios = require("axios");
  const resp = await axios.post("https://api.mubert.com/v2/RecordTrackTTM", {
    method: "RecordTrackTTM",
    params: {
      pat,
      duration,
      tags: [mood.genre, mood.mood, "sports"],
      mode: "track",
      intensity: mood.energy,
    },
  });

  const trackUrl = resp.data?.data?.tasks?.[0]?.download_link;
  if (!trackUrl) return null;
  return { trackUrl, source: "mubert" };
}

/**
 * Select from pre-built music library (Google Drive / local).
 * Falls back to a mood-based filename convention.
 */
function selectFromLibrary(mood, recentlyUsed = []) {
  // Library tracks follow convention: {mood}_{number}.mp3
  // In production, this would list files from Google Drive
  const trackName = `${mood.mood}_01.mp3`;
  return {
    trackUrl: `https://drive.google.com/sports-lore/music/${mood.mood}/${trackName}`,
    trackName,
    source: "library",
  };
}

module.exports = {
  MUSIC_MOOD_MAP, AUDIO_MIX,
  getMoodForStory, generateMubertTrack, selectFromLibrary,
};
```

- [ ] **Step 2: Create music selection endpoint**

```javascript
/**
 * api/lore/select-music.js  →  POST /api/lore/select-music
 * Feature #15: Select and generate background music for a video.
 * Tries Mubert API first, falls back to pre-built library.
 *
 * Body: { rowId }
 * Auth: x-secret header
 */

const { getMoodForStory, generateMubertTrack, selectFromLibrary } = require("./lib/music");
const { getScript, saveScript, getRecentlyUsedTracks, trackMusicUsage } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId } = req.body || {};
  if (!rowId) return res.status(400).json({ error: "rowId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  const mood = getMoodForStory(script.storyType, script.script);

  // Try Mubert first, fall back to library
  let music = await generateMubertTrack(mood);
  if (!music) {
    const recentlyUsed = await getRecentlyUsedTracks(7);
    music = selectFromLibrary(mood, recentlyUsed);
  }

  script.musicMood = mood.mood;
  script.musicTrack = music.trackUrl || music.trackName;
  script.musicSource = music.source;

  await saveScript(rowId, script);
  if (music.trackName) await trackMusicUsage(music.trackName);

  return res.status(200).json({ ok: true, rowId, mood, music });
};
```

- [ ] **Step 3: Commit**

```bash
git add api/lore/lib/music.js api/lore/select-music.js
git commit -m "feat(lore): add music mood selection + Mubert/library fallback (#15)"
```

---

### Task 6: Feature #5 — Parallel Clip Sourcing

**Files:**
- Create: `api/lore/clip-sourcer.js`

- [ ] **Step 1: Create parallel clip sourcer endpoint**

```javascript
/**
 * api/lore/clip-sourcer.js  →  POST /api/lore/clip-sourcer
 * Feature #5: Source clips for a script (or all scripts in a batch in parallel).
 * Uses Pexels API for stock footage, with rejection pattern awareness (Feature #3).
 *
 * Body: { rowId } or { batchId } (batch = parallel all 7)
 * Auth: x-secret header
 */

const axios = require("axios");
const { askClaudeJSON } = require("./lib/claude");
const { getScript, saveScript, getBatchScripts, getRejectionPatterns } = require("./lib/kv-lore");

async function sourceClipsForScript(script, rejectionPatterns) {
  const patternWarning = Object.entries(rejectionPatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => `${reason} (${count}x)`)
    .join(", ");

  const prompt = `You are a video clip researcher for a YouTube Shorts channel about sports history.

Find 4 clip search terms for a 55-second Short about ${script.playerName} (${script.storyType}).

The script:
${script.script}

Each clip should be 5-15 seconds and clearly relate to the story. Generate search terms that would find:
1. A highlight/action clip of the player
2. A contextual clip (the era, team, stadium)
3. A dramatic moment clip (reaction, celebration, crowd)
4. A stats/graphic-style B-roll

${patternWarning ? `AVOID these common clip issues from past weeks: ${patternWarning}. Prioritize clips that clearly show the player's face and jersey number.` : ""}

Return JSON:
{"clips":[{"search_term":"...","description":"...","duration_target":10,"priority":"high|medium"},...],"player_photo_search":"..."}`;

  const result = await askClaudeJSON(prompt, { maxTokens: 500 });

  // Search Pexels for each clip (if API key available)
  const pexelsKey = process.env.PEXELS_API_KEY;
  const clipBriefs = [];

  for (const clip of result.clips) {
    let pexelsUrl = null;
    if (pexelsKey) {
      try {
        const resp = await axios.get("https://api.pexels.com/videos/search", {
          headers: { Authorization: pexelsKey },
          params: { query: clip.search_term, per_page: 3, size: "medium" },
        });
        const video = resp.data?.videos?.[0];
        if (video) {
          const file = video.video_files.find(f => f.quality === "hd") || video.video_files[0];
          pexelsUrl = file?.link;
        }
      } catch (e) {
        console.error("[clip-sourcer] Pexels error:", e.message);
      }
    }

    clipBriefs.push({
      searchTerm: clip.search_term,
      description: clip.description,
      durationTarget: clip.duration_target,
      priority: clip.priority,
      pexelsUrl,
    });
  }

  return { clipBriefs, playerPhotoSearch: result.player_photo_search };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId, batchId } = req.body || {};
  const rejectionPatterns = await getRejectionPatterns();

  // Batch mode: source all scripts in parallel
  if (batchId) {
    const scripts = await getBatchScripts(batchId);
    if (!scripts.length) return res.status(404).json({ error: "No scripts in batch" });

    const results = await Promise.all(
      scripts.map(async (script) => {
        const { clipBriefs, playerPhotoSearch } = await sourceClipsForScript(script, rejectionPatterns);
        script.clipBriefs = clipBriefs;
        script.clipsSourced = clipBriefs.filter(c => c.pexelsUrl).length;
        script.clipSourceStatus = script.clipsSourced > 0 ? "Auto-sourced" : "Manual";
        script.dateSourced = new Date().toISOString();
        script.playerPhotoUrl = playerPhotoSearch;
        await saveScript(script.rowId, script);
        return { rowId: script.rowId, clipsSourced: script.clipsSourced };
      })
    );

    return res.status(200).json({ ok: true, batchId, results });
  }

  // Single mode
  if (!rowId) return res.status(400).json({ error: "rowId or batchId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  const { clipBriefs, playerPhotoSearch } = await sourceClipsForScript(script, rejectionPatterns);
  script.clipBriefs = clipBriefs;
  script.clipsSourced = clipBriefs.filter(c => c.pexelsUrl).length;
  script.clipSourceStatus = script.clipsSourced > 0 ? "Auto-sourced" : "Manual";
  script.dateSourced = new Date().toISOString();
  script.playerPhotoUrl = playerPhotoSearch;
  await saveScript(rowId, script);

  return res.status(200).json({ ok: true, rowId, clipBriefs });
};
```

- [ ] **Step 2: Commit**

```bash
git add api/lore/clip-sourcer.js
git commit -m "feat(lore): add parallel clip sourcer with Pexels + rejection awareness (#5, #3)"
```

---

### Task 7: Weekly Batch Orchestrator

**Files:**
- Create: `api/lore/weekly-batch.js`

- [ ] **Step 1: Create the weekly batch orchestrator that ties Phase 1 together**

```javascript
/**
 * api/lore/weekly-batch.js  →  POST /api/lore/weekly-batch
 * Phased orchestrator to avoid Vercel's 60-second timeout.
 *
 * Phases (each is a separate invocation):
 *   ?phase=stories   — Select 7 stories + generate scripts (default)
 *   ?phase=enhance   — Generate metadata, hooks, music for all scripts
 *   ?phase=clips     — Source clips in parallel
 *
 * The cron dispatcher calls phase=stories first, which saves the batch
 * and triggers phase=enhance. Phase=enhance triggers phase=clips.
 * Each phase completes within ~30-50 seconds.
 *
 * Auth: x-secret header or cron bearer token
 */

const axios = require("axios");
const { askClaudeJSON } = require("./lib/claude");
const { newScriptRow, saveBatch, saveScript, getBatch, getBatchScripts, getRecentAnalytics } = require("./lib/kv-lore");
const { getBatchIdForDate } = require("./lib/utils");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  const authHeader = req.headers.authorization;
  const expected = process.env.CRON_SECRET;
  if (secret !== expected && authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const phase = req.query.phase || "stories";
  const now = new Date();
  const batchId = req.body?.batchId || getBatchIdForDate(now);
  const baseUrl = `https://${req.headers.host}`;
  const headers = { "x-secret": expected, "Content-Type": "application/json" };

  // ── PHASE 1: Story selection + script generation ──
  if (phase === "stories") {
    const recentAnalytics = await getRecentAnalytics(4);
    let analyticsContext = "No analytics data yet — this is a new channel.";
    if (recentAnalytics.length > 0) {
      const byType = {};
      recentAnalytics.forEach(week => {
        if (week.byType) {
          Object.entries(week.byType).forEach(([type, data]) => {
            if (!byType[type]) byType[type] = { views: 0, retention: 0, count: 0 };
            byType[type].views += data.avgViews || 0;
            byType[type].retention += parseFloat(data.avgRetention || 0);
            byType[type].count++;
          });
        }
      });
      analyticsContext = Object.entries(byType)
        .map(([type, d]) => `${type}: ${Math.round(d.views / d.count)} avg views, ${(d.retention / d.count).toFixed(1)}% retention`)
        .sort().join("\n");
    }

    const storyPrompt = `You are the content strategist for Sports Lore, a YouTube Shorts channel about forgotten and surprising sports history.

Select 7 unique story ideas for this week. Each story should be about a different player/event from a different sport if possible.

PERFORMANCE DATA FROM LAST 4 WEEKS:
${analyticsContext}

Story types available:
- forgotten_legend, trending_callback, what_if, rivalry, record_breaker, comeback, scandal, draft_bust, underdog, goat_debate

Weight toward higher-performing story types but include at least 1 experimental type.

Return JSON:
{"stories":[{"player_name":"...","player_sport":"NBA|MLB|NFL|NHL|Soccer|Boxing|Tennis","story_type":"...","one_line_pitch":"..."},...]}`;

    const { stories } = await askClaudeJSON(storyPrompt, { maxTokens: 1000 });

    // Generate scripts (7 Claude calls, ~25-35s total)
    const rowIds = [];
    for (let i = 0; i < stories.length; i++) {
      const story = stories[i];
      const scheduledDate = new Date(now);
      scheduledDate.setDate(scheduledDate.getDate() + (i + 1));

      const scriptPrompt = `Write a 55-second YouTube Shorts script about ${story.player_name} (${story.story_type}).
Pitch: ${story.one_line_pitch}
Rules: ~140 words, scroll-stopping hook first 2 seconds, build tension, satisfying payoff, conversational tone, 1-2 surprising facts, end with CTA.
Return JSON: {"script":"...","word_count":140}`;

      const result = await askClaudeJSON(scriptPrompt, { maxTokens: 800 });

      const row = newScriptRow(batchId, i + 1, {
        scheduledDate: scheduledDate.toISOString().split("T")[0],
        playerName: story.player_name,
        playerSport: story.player_sport,
        storyType: story.story_type,
        script: result.script,
        status: "Pending",
      });

      await saveScript(row.rowId, row);
      rowIds.push(row.rowId);
    }

    await saveBatch(batchId, {
      batchId, weekOf: now.toISOString().split("T")[0],
      rowIds, status: "Pending", createdAt: now.toISOString(), videoCount: stories.length,
    });

    // Fire-and-forget: trigger phase 2
    axios.post(`${baseUrl}/api/lore/weekly-batch?phase=enhance`, { batchId }, { headers }).catch(() => {});

    return res.status(200).json({ ok: true, phase: "stories", batchId, rowIds });
  }

  // ── PHASE 2: Enhance scripts (metadata + hooks + music) ──
  if (phase === "enhance") {
    const scripts = await getBatchScripts(batchId);
    if (!scripts.length) return res.status(404).json({ error: "No scripts in batch" });

    // Process all 7 scripts: 3 Claude calls each, run per-script sequentially
    // but the 3 calls per script are fast (~2s each) = ~42s total
    for (const script of scripts) {
      // Metadata
      try {
        await axios.post(`${baseUrl}/api/lore/generate-metadata`, { rowId: script.rowId }, { headers, timeout: 15000 });
      } catch (e) { console.error(`[batch] metadata failed ${script.rowId}:`, e.message); }

      // Hook
      try {
        await axios.post(`${baseUrl}/api/lore/optimize-hook`, { rowId: script.rowId }, { headers, timeout: 15000 });
      } catch (e) { console.error(`[batch] hook failed ${script.rowId}:`, e.message); }

      // Music
      try {
        await axios.post(`${baseUrl}/api/lore/select-music`, { rowId: script.rowId }, { headers, timeout: 10000 });
      } catch (e) { console.error(`[batch] music failed ${script.rowId}:`, e.message); }
    }

    // Fire-and-forget: trigger phase 3
    axios.post(`${baseUrl}/api/lore/weekly-batch?phase=clips`, { batchId }, { headers }).catch(() => {});

    return res.status(200).json({ ok: true, phase: "enhance", batchId, processed: scripts.length });
  }

  // ── PHASE 3: Clip sourcing (parallel) ──
  if (phase === "clips") {
    try {
      await axios.post(`${baseUrl}/api/lore/clip-sourcer`, { batchId }, { headers, timeout: 50000 });
    } catch (e) { console.error(`[batch] clip sourcing failed:`, e.message); }

    // Mark batch as ready
    const batch = await getBatch(batchId);
    if (batch) {
      batch.status = "Ready";
      await saveBatch(batchId, batch);
    }

    return res.status(200).json({ ok: true, phase: "clips", batchId, status: "Ready" });
  }

  return res.status(400).json({ error: `Unknown phase: ${phase}` });
};
```

- [ ] **Step 2: Commit**

```bash
git add api/lore/weekly-batch.js
git commit -m "feat(lore): add weekly batch orchestrator — story selection + full pipeline"
```

---

## Phase 2 — Time Optimization

### Task 8: Feature #4 — Opt-Out Confirmation (Batch Control)

**Files:**
- Create: `api/lore/batch-control.js`

- [ ] **Step 1: Create batch pause/resume webhook endpoint**

```javascript
/**
 * api/lore/batch-control.js  →  GET/POST /api/lore/batch-control
 * Feature #4: Pause/resume batch production.
 *
 * GET  ?action=pause&batchId=...&token=...  — pause a batch (from email link)
 * GET  ?action=resume&batchId=...&token=... — resume a paused batch
 * POST { batchId, action: "start" }         — auto-start (called by cron)
 */

const { getBatch, saveBatch, getBatchScripts, saveScript } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  const { action, batchId, token } = req.method === "GET"
    ? req.query
    : (req.body || {});

  if (!batchId) return res.status(400).json({ error: "batchId required" });

  // Token validation for webhook links
  if (req.method === "GET" && token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Invalid token" });
  }
  // Secret validation for POST
  if (req.method === "POST") {
    const secret = req.headers["x-secret"] || req.query.secret;
    if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
  }

  const batch = await getBatch(batchId);
  if (!batch) return res.status(404).json({ error: "Batch not found" });

  if (action === "pause") {
    batch.status = "Paused";
    await saveBatch(batchId, batch);

    // Update all script rows to Paused
    const scripts = await getBatchScripts(batchId);
    await Promise.all(scripts.map(s => {
      s.status = "Paused";
      return saveScript(s.rowId, s);
    }));

    // If GET request (email link), return HTML confirmation
    if (req.method === "GET") {
      res.setHeader("Content-Type", "text/html");
      return res.status(200).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:40px">
          <h1>⏸ Batch Paused</h1>
          <p>Batch <strong>${batchId}</strong> has been paused. Auto-start is cancelled.</p>
          <p><a href="/api/lore/batch-control?action=resume&batchId=${batchId}&token=${token}">
            ▶️ Resume Production
          </a></p>
        </body></html>
      `);
    }
    return res.status(200).json({ ok: true, batchId, status: "Paused" });
  }

  if (action === "resume" || action === "start") {
    // Check if paused
    if (action === "start" && batch.status === "Paused") {
      return res.status(200).json({ ok: true, batchId, status: "Paused", message: "Batch is paused, skipping auto-start" });
    }

    batch.status = "Ready";
    await saveBatch(batchId, batch);

    const scripts = await getBatchScripts(batchId);
    await Promise.all(scripts.map(s => {
      if (s.status === "Paused" || s.status === "Pending") s.status = "Ready";
      return saveScript(s.rowId, s);
    }));

    if (req.method === "GET") {
      res.setHeader("Content-Type", "text/html");
      return res.status(200).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:40px">
          <h1>▶️ Batch Resumed</h1>
          <p>Batch <strong>${batchId}</strong> is now active. Production will proceed.</p>
        </body></html>
      `);
    }
    return res.status(200).json({ ok: true, batchId, status: "Ready" });
  }

  return res.status(400).json({ error: "action must be pause, resume, or start" });
};
```

- [ ] **Step 2: Commit**

```bash
git add api/lore/batch-control.js
git commit -m "feat(lore): add batch pause/resume control with email webhook links (#4)"
```

---

### Task 9: Feature #9 — Post Time Optimization

**Files:**
- Create: `api/lore/lib/post-times.js`
- Create: `api/lore/post-schedule.js`

- [ ] **Step 1: Create sport-based posting schedule**

```javascript
/**
 * api/lore/lib/post-times.js
 * Sport-based optimal posting times for YouTube Shorts.
 */

const POST_TIMES = {
  NBA:     "18:00",   // 6 PM EST — pre-game buzz
  MLB:     "15:00",   // 3 PM — afternoon games
  NFL:     "11:00",   // 11 AM — Sunday morning
  NHL:     "17:00",   // 5 PM — pre-game
  Soccer:  "12:00",   // Noon — international audience
  Boxing:  "20:00",   // 8 PM — fight night energy
  Tennis:  "14:00",   // 2 PM — afternoon matches
  default: "19:00",   // 7 PM — general sports
};

function getOptimalPostTime(sport) {
  return POST_TIMES[sport] || POST_TIMES.default;
}

module.exports = { POST_TIMES, getOptimalPostTime };
```

- [ ] **Step 2: Create post schedule endpoint**

```javascript
/**
 * api/lore/post-schedule.js  →  POST /api/lore/post-schedule
 * Feature #9: Calculate and set optimal post times for batch scripts.
 *
 * Body: { batchId }
 * Auth: x-secret header
 */

const { getOptimalPostTime } = require("./lib/post-times");
const { getBatchScripts, saveScript } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { batchId } = req.body || {};
  if (!batchId) return res.status(400).json({ error: "batchId required" });

  const scripts = await getBatchScripts(batchId);
  if (!scripts.length) return res.status(404).json({ error: "No scripts found" });

  const results = await Promise.all(scripts.map(async (script) => {
    const postTime = getOptimalPostTime(script.playerSport);
    script.scheduledPostTime = postTime;
    await saveScript(script.rowId, script);
    return { rowId: script.rowId, sport: script.playerSport, postTime };
  }));

  return res.status(200).json({ ok: true, batchId, schedules: results });
};
```

- [ ] **Step 3: Commit**

```bash
git add api/lore/lib/post-times.js api/lore/post-schedule.js
git commit -m "feat(lore): add sport-based post time optimization (#9)"
```

---

## Phase 3 — Analytics & Testing

### Task 10: Feature #6 — Analytics Feedback Loop

**Files:**
- Create: `api/lore/lib/youtube-api.js`
- Create: `api/lore/analytics.js`

- [ ] **Step 1: Create YouTube API client**

```javascript
/**
 * api/lore/lib/youtube-api.js
 * YouTube Data API v3 + Analytics API client for Sports Lore.
 *
 * Env vars required:
 *   YOUTUBE_API_KEY         — for public data (comments, video details)
 *   YOUTUBE_ACCESS_TOKEN    — OAuth2 token for analytics + uploads
 *   YOUTUBE_REFRESH_TOKEN   — for refreshing access token
 *   YOUTUBE_CLIENT_ID       — OAuth2 client ID
 *   YOUTUBE_CLIENT_SECRET   — OAuth2 client secret
 *   YOUTUBE_CHANNEL_ID      — channel ID for uploads
 */

const axios = require("axios");

const YT_DATA_BASE = "https://www.googleapis.com/youtube/v3";
const YT_ANALYTICS_BASE = "https://youtubeanalytics.googleapis.com/v2";

async function getAccessToken() {
  // If we have a valid access token, use it
  if (process.env.YOUTUBE_ACCESS_TOKEN) return process.env.YOUTUBE_ACCESS_TOKEN;

  // Otherwise refresh
  const resp = await axios.post("https://oauth2.googleapis.com/token", {
    client_id: process.env.YOUTUBE_CLIENT_ID,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET,
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  return resp.data.access_token;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Get video analytics for a list of video IDs.
 */
async function getVideoAnalytics(videoIds, startDate, endDate) {
  const token = await getAccessToken();
  const resp = await axios.get(`${YT_ANALYTICS_BASE}/reports`, {
    headers: authHeaders(token),
    params: {
      ids: "channel==MINE",
      metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained",
      dimensions: "video",
      filters: `video==${videoIds.join(",")}`,
      startDate,
      endDate,
    },
  });
  return resp.data;
}

/**
 * Get comment threads for a video.
 */
async function getCommentThreads(videoId, maxResults = 20) {
  const token = await getAccessToken();
  const resp = await axios.get(`${YT_DATA_BASE}/commentThreads`, {
    headers: authHeaders(token),
    params: { part: "snippet", videoId, maxResults, order: "relevance" },
  });
  return resp.data.items || [];
}

/**
 * Post a reply to a comment.
 */
async function replyToComment(parentId, text) {
  const token = await getAccessToken();
  const resp = await axios.post(`${YT_DATA_BASE}/comments`, {
    snippet: { parentId, textOriginal: text },
  }, {
    headers: authHeaders(token),
    params: { part: "snippet" },
  });
  return resp.data;
}

/**
 * Upload a video to YouTube.
 */
async function uploadVideo({ title, description, tags, videoBuffer, thumbnailBuffer, publishAt }) {
  const token = await getAccessToken();
  const channelId = process.env.YOUTUBE_CHANNEL_ID;

  // Step 1: Insert video
  const metadata = {
    snippet: { title, description, tags, channelId, categoryId: "17" }, // Sports
    status: {
      privacyStatus: publishAt ? "private" : "public",
      publishAt: publishAt || undefined,
      selfDeclaredMadeForKids: false,
    },
  };

  // For actual upload, we'd use resumable upload protocol
  // This is a simplified version — in production, use googleapis SDK or multipart upload
  const resp = await axios.post(
    `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`,
    metadata,
    { headers: { ...authHeaders(token), "Content-Type": "application/json" } }
  );

  return { videoId: resp.data?.id, uploadUrl: resp.headers?.location };
}

/**
 * Set custom thumbnail for a video.
 */
async function setThumbnail(videoId, thumbnailUrl) {
  const token = await getAccessToken();
  // Download thumbnail then upload to YouTube
  const imgResp = await axios.get(thumbnailUrl, { responseType: "arraybuffer" });
  await axios.post(
    `${YT_DATA_BASE}/thumbnails/set?videoId=${videoId}`,
    imgResp.data,
    { headers: { ...authHeaders(token), "Content-Type": "image/png" } }
  );
}

module.exports = {
  getAccessToken, getVideoAnalytics, getCommentThreads,
  replyToComment, uploadVideo, setThumbnail,
};
```

- [ ] **Step 2: Create analytics feedback endpoint**

```javascript
/**
 * api/lore/analytics.js  →  POST /api/lore/analytics
 * Feature #6: Pull YouTube analytics, analyze by story type, save for next week's selection.
 * Runs Sunday 8PM (1 hour before weekly-batch).
 *
 * Auth: x-secret header or cron bearer token
 */

const { getVideoAnalytics } = require("./lib/youtube-api");
const { saveAnalytics, getRecentAnalytics, getBatch, getBatchScripts } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "POST or GET" });

  const secret = req.headers["x-secret"] || req.query.secret;
  const authHeader = req.headers.authorization;
  const expected = process.env.CRON_SECRET;
  if (secret !== expected && authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Find last week's batch
  const now = new Date();
  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const weekNum = getISOWeek(lastWeek);
  const batchId = `${lastWeek.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;

  const scripts = await getBatchScripts(batchId);
  const videoIds = scripts.map(s => s.youtubeVideoId).filter(Boolean);

  if (!videoIds.length) {
    return res.status(200).json({ ok: true, message: "No published videos found for last week", batchId });
  }

  // Pull analytics
  const startDate = lastWeek.toISOString().split("T")[0];
  const endDate = now.toISOString().split("T")[0];

  let analyticsData;
  try {
    analyticsData = await getVideoAnalytics(videoIds, startDate, endDate);
  } catch (e) {
    return res.status(500).json({ error: "YouTube Analytics API failed", detail: e.message });
  }

  // Analyze by story type
  const byType = {};
  const rows = analyticsData.rows || [];
  rows.forEach((row, idx) => {
    const script = scripts.find(s => s.youtubeVideoId === row[0]);
    if (!script) return;
    const type = script.storyType || "unknown";
    if (!byType[type]) byType[type] = { views: 0, retention: 0, subs: 0, count: 0 };
    byType[type].views += row[1] || 0;           // views
    byType[type].retention += row[4] || 0;       // averageViewPercentage
    byType[type].subs += row[5] || 0;            // subscribersGained
    byType[type].count++;
  });

  // Calculate averages
  Object.keys(byType).forEach(type => {
    byType[type].avgViews = Math.round(byType[type].views / byType[type].count);
    byType[type].avgRetention = (byType[type].retention / byType[type].count).toFixed(1);
  });

  const weekOf = now.toISOString().split("T")[0];
  await saveAnalytics(weekOf, { byType, weekOf, batchId });

  return res.status(200).json({ ok: true, weekOf, byType });
};

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}
```

- [ ] **Step 3: Commit**

```bash
git add api/lore/lib/youtube-api.js api/lore/analytics.js
git commit -m "feat(lore): add YouTube analytics feedback loop (#6)"
```

---

### Task 11: Feature #8 — A/B Title Testing

**Files:**
- Create: `api/lore/ab-test.js`

- [ ] **Step 1: Create A/B test tracking endpoint**

```javascript
/**
 * api/lore/ab-test.js  →  POST /api/lore/ab-test
 * Feature #8: Track which title (A or B) was used and its performance.
 *
 * Body: { rowId, version: "A"|"B" } — set which title to use
 * GET  ?batchId=... — get A/B results for a batch
 */

const { getScript, saveScript, getBatchScripts, getPublished } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  // GET: view A/B results
  if (req.method === "GET") {
    const { batchId } = req.query;
    if (!batchId) return res.status(400).json({ error: "batchId required" });

    const scripts = await getBatchScripts(batchId);
    const results = scripts.map(s => ({
      rowId: s.rowId,
      titleA: s.titleA,
      titleB: s.titleB,
      titleUsed: s.titleUsed,
      viewsAt48h: s.viewsAt48h,
    }));

    return res.status(200).json({ ok: true, results });
  }

  // POST: assign title version
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });

  const { rowId, version } = req.body || {};
  if (!rowId) return res.status(400).json({ error: "rowId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  if (version === "A" || version === "B") {
    script.titleUsed = version === "A" ? script.titleA : script.titleB;
    script.titleVersion = version;
  } else {
    // Auto-alternate based on day of week
    const useB = new Date().getDay() % 2 === 0;
    script.titleUsed = useB ? script.titleB : script.titleA;
    script.titleVersion = useB ? "B" : "A";
  }

  await saveScript(rowId, script);
  return res.status(200).json({ ok: true, rowId, titleUsed: script.titleUsed, version: script.titleVersion });
};
```

- [ ] **Step 2: Commit**

```bash
git add api/lore/ab-test.js
git commit -m "feat(lore): add A/B title testing with auto-alternation (#8)"
```

---

## Phase 4 — Visual Polish

### Task 12: Feature #2 — Thumbnail Auto-Generation

**Files:**
- Create: `api/lore/lib/creatomate.js`
- Create: `api/lore/generate-thumbnail.js`

- [ ] **Step 1: Create Creatomate API client**

```javascript
/**
 * api/lore/lib/creatomate.js
 * Creatomate API client for video rendering and thumbnail generation.
 *
 * Env vars: CREATOMATE_API_KEY, CREATOMATE_THUMBNAIL_TEMPLATE_ID, CREATOMATE_VIDEO_TEMPLATE_ID
 */

const axios = require("axios");

const BASE_URL = "https://api.creatomate.com/v1";

function headers() {
  return {
    Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}`,
    "Content-Type": "application/json",
  };
}

/**
 * Render a thumbnail using the thumbnail template.
 */
async function renderThumbnail({ playerName, hookText, playerImageUrl, accentColor }) {
  const resp = await axios.post(`${BASE_URL}/renders`, {
    template_id: process.env.CREATOMATE_THUMBNAIL_TEMPLATE_ID,
    modifications: {
      player_name: playerName,
      hook_text: (hookText || "").slice(0, 30),
      player_image: playerImageUrl,
      accent_color: accentColor || "#FF4444",
    },
  }, { headers: headers() });

  // Creatomate returns an array of render jobs
  const render = resp.data?.[0];
  return { renderId: render?.id, url: render?.url, status: render?.status };
}

/**
 * Render a video using the video template.
 */
async function renderVideo({ voiceoverUrl, musicTrackUrl, clipUrls, textOverlays }) {
  const elements = [];

  // Background music with ducking
  if (musicTrackUrl) {
    elements.push({
      type: "audio",
      name: "background_music",
      source: musicTrackUrl,
      volume: "25%",
      audio_fade_in: "3s",
      audio_fade_out: "3s",
    });
  }

  // Voiceover
  if (voiceoverUrl) {
    elements.push({
      type: "audio",
      name: "voiceover",
      source: voiceoverUrl,
      volume: "100%",
    });
  }

  const resp = await axios.post(`${BASE_URL}/renders`, {
    template_id: process.env.CREATOMATE_VIDEO_TEMPLATE_ID,
    modifications: {
      voiceover: voiceoverUrl,
      background_music: musicTrackUrl,
      ...textOverlays,
    },
  }, { headers: headers() });

  const render = resp.data?.[0];
  return { renderId: render?.id, url: render?.url, status: render?.status };
}

/**
 * Check render status (polling).
 */
async function getRenderStatus(renderId) {
  const resp = await axios.get(`${BASE_URL}/renders/${renderId}`, { headers: headers() });
  return resp.data;
}

module.exports = { renderThumbnail, renderVideo, getRenderStatus };
```

- [ ] **Step 2: Create thumbnail generation endpoint**

```javascript
/**
 * api/lore/generate-thumbnail.js  →  POST /api/lore/generate-thumbnail
 * Feature #2: Generate thumbnail via Creatomate for a script.
 *
 * Body: { rowId }
 * Auth: x-secret header
 */

const { renderThumbnail } = require("./lib/creatomate");
const { getScript, saveScript } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId } = req.body || {};
  if (!rowId) return res.status(400).json({ error: "rowId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  if (!process.env.CREATOMATE_API_KEY) {
    return res.status(200).json({ ok: true, rowId, message: "Creatomate not configured, skipping thumbnail" });
  }

  const hookText = script.hookLine || script.titleA || script.playerName;

  const result = await renderThumbnail({
    playerName: script.playerName,
    hookText,
    playerImageUrl: script.playerPhotoUrl,
    accentColor: "#FF4444",
  });

  script.thumbnailUrl = result.url || "";
  await saveScript(rowId, script);

  return res.status(200).json({ ok: true, rowId, thumbnail: result });
};
```

- [ ] **Step 3: Commit**

```bash
git add api/lore/lib/creatomate.js api/lore/generate-thumbnail.js
git commit -m "feat(lore): add Creatomate thumbnail auto-generation (#2)"
```

---

### Task 13: Feature #12 — Underperformer Re-Upload Strategy

**Files:**
- Create: `api/lore/performance-check.js`

- [ ] **Step 1: Create performance check + re-upload queue endpoint**

```javascript
/**
 * api/lore/performance-check.js  →  POST /api/lore/performance-check
 * Feature #12: Check 48h performance, queue re-uploads for underperformers.
 * Runs daily at 10 AM.
 *
 * Auth: x-secret header or cron bearer token
 */

const { askClaudeJSON } = require("./lib/claude");
const { getVideoAnalytics } = require("./lib/youtube-api");
const { getBatch, getBatchScripts, getScript, saveScript, queueReupload, getRecentAnalytics } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  const secret = req.headers["x-secret"] || req.query.secret;
  const authHeader = req.headers.authorization;
  const expected = process.env.CRON_SECRET;
  if (secret !== expected && authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Find videos uploaded 48 hours ago
  const now = new Date();
  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const checkDate = twoDaysAgo.toISOString().split("T")[0];

  // Get channel average from recent analytics
  const recentAnalytics = await getRecentAnalytics(4);
  let channelAvgViews = 10000; // default
  if (recentAnalytics.length > 0) {
    let totalViews = 0, totalCount = 0;
    recentAnalytics.forEach(week => {
      Object.values(week.byType || {}).forEach(t => {
        totalViews += t.avgViews || 0;
        totalCount++;
      });
    });
    if (totalCount > 0) channelAvgViews = totalViews / totalCount;
  }

  // Find scripts scheduled for 2 days ago
  // Scan recent batches (this is simplified — in production, maintain an index)
  const weekNum = getISOWeek(twoDaysAgo);
  const batchId = `${twoDaysAgo.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  const scripts = await getBatchScripts(batchId);

  const toCheck = scripts.filter(s =>
    s.scheduledDate === checkDate && s.youtubeVideoId
  );

  if (!toCheck.length) {
    return res.status(200).json({ ok: true, message: "No videos to check for " + checkDate });
  }

  const videoIds = toCheck.map(s => s.youtubeVideoId);
  let analytics;
  try {
    analytics = await getVideoAnalytics(videoIds, checkDate, now.toISOString().split("T")[0]);
  } catch (e) {
    return res.status(500).json({ error: "Analytics API failed", detail: e.message });
  }

  const results = [];
  const rows = analytics.rows || [];

  for (const script of toCheck) {
    const row = rows.find(r => r[0] === script.youtubeVideoId);
    if (!row) continue;

    const views = row[1] || 0;
    const retention = row[4] || 0;

    script.viewsAt48h = views;
    script.retentionAt48h = retention;
    await saveScript(script.rowId, script);

    const isUnderperformer = views < channelAvgViews * 0.4;
    const lowRetention = retention < 30;

    if (isUnderperformer) {
      const reason = lowRetention ? "bad_hook" : "bad_title";

      // Generate new title + hook via Claude
      const prompt = `This YouTube Short about ${script.playerName} underperformed (${views} views, ${retention}% retention).

Original title: "${script.titleUsed || script.titleA}"
Original hook: "${script.hookLine}"

The issue is likely: ${reason === "bad_hook" ? "viewers leave in first 3 seconds — the hook is weak" : "the title doesn't compel clicks"}

Generate a completely different approach:
{"new_title":"...","new_hook":"...","change_rationale":"..."}`;

      const reuploadData = await askClaudeJSON(prompt, { maxTokens: 300 });

      // Schedule re-upload for next week
      const reuploadDate = new Date(now);
      reuploadDate.setDate(reuploadDate.getDate() + 7);

      await queueReupload(script.youtubeVideoId, {
        originalVideoId: script.youtubeVideoId,
        originalTitle: script.titleUsed || script.titleA,
        originalViews48h: views,
        newTitle: reuploadData.new_title,
        newHook: reuploadData.new_hook,
        rationale: reuploadData.change_rationale,
        scheduledDate: reuploadDate.toISOString().split("T")[0],
        status: "Pending",
        rowId: script.rowId,
      });

      results.push({ rowId: script.rowId, action: "re-upload", views, retention, reason });
    } else {
      results.push({ rowId: script.rowId, action: "none", views, retention });
    }
  }

  return res.status(200).json({ ok: true, checkDate, channelAvgViews, results });
};

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}
```

- [ ] **Step 2: Commit**

```bash
git add api/lore/performance-check.js
git commit -m "feat(lore): add 48h performance check + re-upload queue (#12)"
```

---

## Phase 5 — Distribution & Engagement

### Task 14: Feature #10 — Cross-Posting (TikTok + Instagram Reels)

**Files:**
- Create: `api/lore/lib/cross-post.js`
- Create: `api/lore/cross-post.js`

- [ ] **Step 1: Create cross-posting API clients**

```javascript
/**
 * api/lore/lib/cross-post.js
 * TikTok Content Posting API + Instagram Graph API clients.
 *
 * Env vars:
 *   TIKTOK_ACCESS_TOKEN     — TikTok developer access token
 *   INSTAGRAM_USER_ID       — Instagram business account user ID
 *   INSTAGRAM_ACCESS_TOKEN  — Instagram Graph API token
 */

const axios = require("axios");

// Platform-specific hashtags
const PLATFORM_HASHTAGS = {
  youtube:   "#shorts #nba #basketball #sportshistory",
  tiktok:    "#fyp #foryou #nba #basketball #sportsfact #didyouknow",
  instagram: "#reels #nba #basketball #sportshistory #explore",
};

/**
 * Upload video to TikTok.
 */
async function postToTikTok({ title, description, videoUrl }) {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token) return { ok: false, error: "TikTok not configured" };

  const resp = await axios.post(
    "https://open.tiktokapis.com/v2/post/publish/video/init/",
    {
      post_info: {
        title,
        description: `${description} ${PLATFORM_HASHTAGS.tiktok}`,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: videoUrl,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  return { ok: true, publishId: resp.data?.data?.publish_id };
}

/**
 * Upload video to Instagram Reels (two-step process).
 */
async function postToInstagram({ description, videoUrl }) {
  const userId = process.env.INSTAGRAM_USER_ID;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!userId || !token) return { ok: false, error: "Instagram not configured" };

  // Step 1: Create media container
  const createResp = await axios.post(
    `https://graph.facebook.com/v19.0/${userId}/media`,
    null,
    {
      params: {
        media_type: "REELS",
        video_url: videoUrl,
        caption: `${description} ${PLATFORM_HASHTAGS.instagram}`,
        access_token: token,
      },
    }
  );

  const containerId = createResp.data?.id;
  if (!containerId) return { ok: false, error: "Failed to create IG container" };

  // Wait for processing (Instagram needs time)
  await new Promise(resolve => setTimeout(resolve, 30000));

  // Step 2: Publish
  const publishResp = await axios.post(
    `https://graph.facebook.com/v19.0/${userId}/media_publish`,
    null,
    { params: { creation_id: containerId, access_token: token } }
  );

  return { ok: true, mediaId: publishResp.data?.id };
}

module.exports = { postToTikTok, postToInstagram, PLATFORM_HASHTAGS };
```

- [ ] **Step 2: Create cross-post endpoint**

```javascript
/**
 * api/lore/cross-post.js  →  POST /api/lore/cross-post
 * Feature #10: Cross-post a published YouTube video to TikTok + Instagram Reels.
 *
 * Body: { rowId, videoUrl } — videoUrl is the Creatomate output (no YouTube watermark)
 * Auth: x-secret header
 */

const { postToTikTok, postToInstagram } = require("./lib/cross-post");
const { getScript, saveScript } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId, videoUrl } = req.body || {};
  if (!rowId || !videoUrl) return res.status(400).json({ error: "rowId and videoUrl required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  const title = script.titleUsed || script.titleA;
  const description = script.description || "";

  const results = {};

  // TikTok
  try {
    results.tiktok = await postToTikTok({ title, description, videoUrl });
    if (results.tiktok.ok) script.tiktokUrl = `https://tiktok.com/@sportslore`; // Will be updated with actual URL
  } catch (e) {
    results.tiktok = { ok: false, error: e.message };
  }

  // Instagram
  try {
    results.instagram = await postToInstagram({ description, videoUrl });
    if (results.instagram.ok) script.instagramUrl = `https://instagram.com/sportslore`; // Will be updated
  } catch (e) {
    results.instagram = { ok: false, error: e.message };
  }

  await saveScript(rowId, script);

  return res.status(200).json({ ok: true, rowId, results });
};
```

- [ ] **Step 3: Commit**

```bash
git add api/lore/lib/cross-post.js api/lore/cross-post.js
git commit -m "feat(lore): add TikTok + Instagram Reels cross-posting (#10)"
```

---

### Task 15: Feature #11 — Comment Monitoring & Reply Suggestions

**Files:**
- Create: `api/lore/comments.js`

- [ ] **Step 1: Create comment monitoring endpoint**

```javascript
/**
 * api/lore/comments.js  →  POST /api/lore/comments
 * Feature #11: Monitor comments on recent videos, score them, suggest replies.
 * Runs hourly for first 24h after upload.
 *
 * Auth: x-secret header or cron bearer token
 */

const { askClaudeJSON } = require("./lib/claude");
const { getCommentThreads } = require("./lib/youtube-api");
const { getBatch, getBatchScripts } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  const secret = req.headers["x-secret"] || req.query.secret;
  const authHeader = req.headers.authorization;
  const expected = process.env.CRON_SECRET;
  if (secret !== expected && authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Find videos uploaded in last 24 hours
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  // Get current week's batch
  const weekNum = getISOWeek(now);
  const batchId = `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  const scripts = await getBatchScripts(batchId);

  const recentVideos = scripts.filter(s => {
    if (!s.youtubeVideoId) return false;
    const uploadDate = new Date(s.scheduledDate);
    return uploadDate >= yesterday && uploadDate <= now;
  });

  if (!recentVideos.length) {
    return res.status(200).json({ ok: true, message: "No recent videos to monitor" });
  }

  const allDigests = [];

  for (const script of recentVideos) {
    // Fetch comments
    let comments;
    try {
      comments = await getCommentThreads(script.youtubeVideoId, 20);
    } catch (e) {
      console.error(`[comments] Failed to fetch for ${script.youtubeVideoId}:`, e.message);
      continue;
    }

    if (!comments.length) continue;

    // Score comments
    const scored = comments.map(c => {
      const snippet = c.snippet.topLevelComment.snippet;
      const text = snippet.textDisplay;
      const likes = snippet.likeCount || 0;

      let score = likes * 2;
      if (text.includes("?")) score += 5;
      if (text.length > 50) score += 3;
      if (/who|what|when|why|how/i.test(text)) score += 3;

      return {
        commentId: c.snippet.topLevelComment.id,
        text,
        likes,
        score,
        author: snippet.authorDisplayName,
      };
    }).sort((a, b) => b.score - a.score).slice(0, 5);

    // Generate reply suggestions via Claude
    const commentsText = scored.map((c, i) => `${i + 1}. "${c.text}" (${c.likes} likes, by ${c.author})`).join("\n");

    const prompt = `You manage a YouTube Shorts channel about sports history. Here are the top comments on today's video about ${script.playerName}:

${commentsText}

For each comment, suggest a short, authentic reply (1-2 sentences). Be:
- Conversational, not corporate
- Add a fun fact when relevant
- Ask a follow-up question to keep the thread going
- Never be defensive

Return JSON array:
[{"comment_id":"...","suggested_reply":"..."}]`;

    const replies = await askClaudeJSON(prompt, { maxTokens: 500 });

    allDigests.push({
      videoId: script.youtubeVideoId,
      playerName: script.playerName,
      title: script.titleUsed || script.titleA,
      comments: scored,
      suggestedReplies: replies,
    });
  }

  return res.status(200).json({ ok: true, digests: allDigests });
};

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}
```

- [ ] **Step 2: Commit**

```bash
git add api/lore/comments.js
git commit -m "feat(lore): add comment monitoring with Claude reply suggestions (#11)"
```

---

## Phase 6 — Reliability & Polish

### Task 16: Feature #3 — Clip Quality Feedback Loop (Webhook)

**Files:**
- Create: `api/lore/clip-feedback.js`

- [ ] **Step 1: Create clip rejection webhook**

```javascript
/**
 * api/lore/clip-feedback.js  →  GET /api/lore/clip-feedback
 * Feature #3: Webhook to log clip rejections.
 * Called from rejection links in clip preview emails.
 *
 * GET ?rowId=...&reason=wrong_player|low_res|irrelevant&token=...
 */

const { addRejection, getScript } = require("./lib/kv-lore");

const VALID_REASONS = ["wrong_player", "low_res", "irrelevant", "wrong_sport", "too_short", "bad_audio"];

module.exports = async function handler(req, res) {
  const { rowId, reason, token } = req.query;

  if (token !== process.env.CRON_SECRET) return res.status(401).json({ error: "Invalid token" });
  if (!rowId || !reason) return res.status(400).json({ error: "rowId and reason required" });

  const reasons = reason.split(",").filter(r => VALID_REASONS.includes(r));
  if (!reasons.length) return res.status(400).json({ error: `Invalid reason. Use: ${VALID_REASONS.join(", ")}` });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  await addRejection(rowId, reasons);

  // Return HTML for email link clicks
  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(`
    <html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h1>Clip Rejection Logged</h1>
      <p>Recorded <strong>${reasons.join(", ")}</strong> for ${script.playerName} (${script.rowId})</p>
      <p>This feedback improves future clip sourcing.</p>
    </body></html>
  `);
};
```

- [ ] **Step 2: Commit**

```bash
git add api/lore/clip-feedback.js
git commit -m "feat(lore): add clip rejection webhook for quality feedback loop (#3)"
```

---

### Task 17: Feature #13 — FFmpeg Fallback Renderer

**Files:**
- Create: `api/lore/render-fallback.js`

- [ ] **Step 1: Create FFmpeg fallback endpoint**

```javascript
/**
 * api/lore/render-fallback.js  →  POST /api/lore/render-fallback
 * Feature #13: FFmpeg fallback when Creatomate is down.
 * Renders a basic video: static player image + voiceover + text overlay.
 *
 * NOTE: FFmpeg must be available on the server. On Vercel, this would need
 * a custom runtime or external render service. This endpoint documents the
 * logic — actual FFmpeg execution may need to run on a separate server.
 *
 * Body: { rowId }
 * Auth: x-secret header
 */

const { renderThumbnail, renderVideo, getRenderStatus } = require("./lib/creatomate");
const { getScript, saveScript } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId } = req.body || {};
  if (!rowId) return res.status(400).json({ error: "rowId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  // Step 1: Try Creatomate
  let render = null;
  if (process.env.CREATOMATE_API_KEY) {
    try {
      render = await renderVideo({
        voiceoverUrl: script.voiceoverUrl,
        musicTrackUrl: script.musicTrack,
        clipUrls: (script.clipBriefs || []).map(c => c.pexelsUrl).filter(Boolean),
        textOverlays: { hook_text: script.hookLine, player_name: script.playerName },
      });
    } catch (e) {
      console.error("[render] Creatomate attempt 1 failed:", e.message);

      // Retry once after a delay
      await new Promise(resolve => setTimeout(resolve, 5000));
      try {
        render = await renderVideo({
          voiceoverUrl: script.voiceoverUrl,
          musicTrackUrl: script.musicTrack,
          clipUrls: (script.clipBriefs || []).map(c => c.pexelsUrl).filter(Boolean),
          textOverlays: { hook_text: script.hookLine, player_name: script.playerName },
        });
      } catch (e2) {
        console.error("[render] Creatomate attempt 2 failed:", e2.message);
      }
    }
  }

  if (render && render.url) {
    return res.status(200).json({ ok: true, rowId, source: "creatomate", videoUrl: render.url });
  }

  // Step 2: FFmpeg fallback
  // On Vercel serverless, we can't run FFmpeg directly.
  // This returns the FFmpeg command that should be run on an external server.
  const ffmpegCommand = [
    "ffmpeg",
    "-loop", "1",
    "-i", `"${script.playerPhotoUrl}"`,
    "-i", `"${script.voiceoverUrl || "voiceover.mp3"}"`,
    script.musicTrack ? `-i "${script.musicTrack}"` : "",
    "-vf", `"drawtext=text='${(script.hookLine || "").replace(/'/g, "\\'")}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=h-200"`,
    "-c:v", "libx264",
    "-tune", "stillimage",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-pix_fmt", "yuv420p",
    `"output_${rowId}.mp4"`,
  ].filter(Boolean).join(" ");

  return res.status(200).json({
    ok: true,
    rowId,
    source: "ffmpeg_fallback",
    warning: "Creatomate was unavailable. FFmpeg command generated for external execution.",
    ffmpegCommand,
  });
};
```

- [ ] **Step 2: Commit**

```bash
git add api/lore/render-fallback.js
git commit -m "feat(lore): add FFmpeg fallback renderer for Creatomate outages (#13)"
```

---

### Task 18: Video Production Orchestrator

**Files:**
- Create: `api/lore/lib/elevenlabs.js`
- Create: `api/lore/video-production.js`

- [ ] **Step 1: Create ElevenLabs TTS client**

```javascript
/**
 * api/lore/lib/elevenlabs.js
 * ElevenLabs Text-to-Speech API client.
 *
 * Env vars: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID
 */

const axios = require("axios");

const BASE_URL = "https://api.elevenlabs.io/v1";

/**
 * Generate voiceover audio from script text.
 * Returns a URL to the generated audio file.
 */
async function generateVoiceover(text, voiceId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  const vid = voiceId || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // default: Rachel

  const resp = await axios.post(
    `${BASE_URL}/text-to-speech/${vid}`,
    {
      text,
      model_id: "eleven_monolingual_v1",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    },
    {
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      responseType: "arraybuffer",
    }
  );

  // In production, upload to Google Drive or cloud storage and return URL
  // For now, return base64 data URL
  const base64 = Buffer.from(resp.data).toString("base64");
  return `data:audio/mpeg;base64,${base64}`;
}

module.exports = { generateVoiceover };
```

- [ ] **Step 2: Create video production orchestrator**

```javascript
/**
 * api/lore/video-production.js  →  POST /api/lore/video-production
 * Full video production pipeline for a single script:
 * 1. Generate voiceover (ElevenLabs) with hook line as first sentence
 * 2. Select A/B title
 * 3. Calculate post time
 * 4. Render video (Creatomate, with music + clips)
 * 5. Generate thumbnail
 * 6. Upload to YouTube
 * 7. Set custom thumbnail
 * 8. Cross-post to TikTok + Instagram
 * 9. Log to published
 *
 * Body: { rowId }
 * Auth: x-secret header
 */

const { generateVoiceover } = require("./lib/elevenlabs");
const { renderVideo, getRenderStatus } = require("./lib/creatomate");
const { uploadVideo, setThumbnail } = require("./lib/youtube-api");
const { postToTikTok, postToInstagram } = require("./lib/cross-post");
const { getOptimalPostTime } = require("./lib/post-times");
const { getScript, saveScript, savePublished } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId } = req.body || {};
  if (!rowId) return res.status(400).json({ error: "rowId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  const log = { rowId, steps: {} };

  // Step 1: Generate voiceover
  // Use hook line as first sentence, then rest of script
  const voiceoverText = script.hookLine
    ? script.hookLine + ". " + script.script.replace(/^[^.!?]+[.!?]\s*/, "")
    : script.script;

  try {
    script.voiceoverUrl = await generateVoiceover(voiceoverText);
    log.steps.voiceover = script.voiceoverUrl ? "ok" : "skipped (no API key)";
  } catch (e) {
    log.steps.voiceover = "failed: " + e.message;
  }

  // Step 2: Select title (A/B alternation)
  const useB = new Date().getDay() % 2 === 0;
  script.titleUsed = useB ? (script.titleB || script.titleA) : script.titleA;
  script.titleVersion = useB ? "B" : "A";
  log.steps.title = `Using title ${script.titleVersion}: "${script.titleUsed}"`;

  // Step 3: Calculate post time
  script.scheduledPostTime = getOptimalPostTime(script.playerSport);
  log.steps.postTime = script.scheduledPostTime;

  // Step 4: Render video
  let videoUrl = null;
  try {
    const render = await renderVideo({
      voiceoverUrl: script.voiceoverUrl,
      musicTrackUrl: script.musicTrack,
      clipUrls: (script.clipBriefs || []).map(c => c.pexelsUrl).filter(Boolean),
      textOverlays: { hook_text: script.hookLine, player_name: script.playerName },
    });
    videoUrl = render.url;
    log.steps.render = videoUrl ? "ok" : "no URL returned";
  } catch (e) {
    log.steps.render = "failed: " + e.message;
  }

  // Step 5: Upload to YouTube
  if (videoUrl) {
    try {
      const publishAt = `${script.scheduledDate}T${script.scheduledPostTime}:00-05:00`; // EST
      const upload = await uploadVideo({
        title: script.titleUsed,
        description: `${script.description}\n\n${(script.hashtags || []).join(" ")}`,
        tags: script.hashtags || [],
        videoBuffer: null, // Would download from videoUrl in production
        publishAt,
      });
      script.youtubeVideoId = upload.videoId;
      script.youtubeUrl = `https://youtube.com/shorts/${upload.videoId}`;
      log.steps.youtube = script.youtubeUrl || "upload initiated";
    } catch (e) {
      log.steps.youtube = "failed: " + e.message;
    }
  }

  // Step 6: Set custom thumbnail
  if (script.youtubeVideoId && script.thumbnailUrl) {
    try {
      await setThumbnail(script.youtubeVideoId, script.thumbnailUrl);
      log.steps.thumbnail = "ok";
    } catch (e) {
      log.steps.thumbnail = "failed: " + e.message;
    }
  }

  // Step 7: Cross-post
  if (videoUrl) {
    try {
      const tiktok = await postToTikTok({ title: script.titleUsed, description: script.description, videoUrl });
      log.steps.tiktok = tiktok.ok ? "ok" : tiktok.error;
    } catch (e) {
      log.steps.tiktok = "failed: " + e.message;
    }

    try {
      const ig = await postToInstagram({ description: script.description, videoUrl });
      log.steps.instagram = ig.ok ? "ok" : ig.error;
    } catch (e) {
      log.steps.instagram = "failed: " + e.message;
    }
  }

  // Step 8: Update status and save
  script.status = "Produced";
  await saveScript(rowId, script);

  // Save to published log
  if (script.youtubeVideoId) {
    await savePublished(script.youtubeVideoId, {
      videoId: script.youtubeVideoId,
      rowId: script.rowId,
      title: script.titleUsed,
      titleVersion: script.titleVersion,
      playerName: script.playerName,
      storyType: script.storyType,
      publishedAt: new Date().toISOString(),
      youtubeUrl: script.youtubeUrl,
      tiktokUrl: script.tiktokUrl,
      instagramUrl: script.instagramUrl,
    });
  }

  return res.status(200).json({ ok: true, log });
};
```

- [ ] **Step 3: Commit**

```bash
git add api/lore/lib/elevenlabs.js api/lore/video-production.js
git commit -m "feat(lore): add full video production pipeline — voiceover, render, upload, cross-post"
```

---

### Task 19: Cron Entry Point for Sports Lore Workflows

**Files:**
- Create: `api/lore/cron-lore.js`
- Modify: `vercel.json`

- [ ] **Step 1: Create the cron handler that dispatches all scheduled workflows**

```javascript
/**
 * api/lore/cron-lore.js  →  GET /api/lore/cron-lore
 * Central cron dispatcher for all Sports Lore scheduled workflows.
 *
 * Schedule (configured in vercel.json):
 *   Sunday 8PM EST  → analytics feedback
 *   Sunday 9PM EST  → weekly batch (story selection + pipeline)
 *   Monday 6AM EST  → batch auto-start (video production)
 *   Daily 10AM EST  → performance check (48h underperformer detection)
 *   Hourly           → comment monitoring (first 24h after upload)
 *
 * Query: ?workflow=analytics|weekly-batch|auto-start|performance-check|comments
 */

const axios = require("axios");
const { getBatch, getBatchScripts } = require("./lib/kv-lore");
const { getBatchIdForDate } = require("./lib/utils");

module.exports = async function handler(req, res) {
  // Auth: Vercel cron injects Bearer token
  const authHeader = req.headers.authorization;
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const workflow = req.query.workflow;
  if (!workflow) return res.status(400).json({ error: "workflow query param required" });

  const baseUrl = `https://${req.headers.host}`;
  const headers = { "x-secret": expected, "Content-Type": "application/json" };

  try {
    switch (workflow) {
      case "analytics": {
        const resp = await axios.post(`${baseUrl}/api/lore/analytics`, {}, { headers });
        return res.status(200).json({ workflow, result: resp.data });
      }

      case "weekly-batch": {
        const resp = await axios.post(`${baseUrl}/api/lore/weekly-batch?phase=stories`, {}, { headers });
        return res.status(200).json({ workflow, result: resp.data });
      }

      case "auto-start": {
        const batchId = getBatchIdForDate(new Date());
        const batch = await getBatch(batchId);
        if (!batch) return res.status(200).json({ workflow, message: "No batch found" });

        if (batch.status === "Paused") {
          return res.status(200).json({ workflow, message: "Batch is paused, skipping auto-start" });
        }

        // Fire-and-forget production for each ready script (each is its own function invocation)
        const scripts = await getBatchScripts(batchId);
        const readyScripts = scripts.filter(s => s.status === "Pending" || s.status === "Ready");

        readyScripts.forEach(script => {
          axios.post(`${baseUrl}/api/lore/video-production`, { rowId: script.rowId }, { headers }).catch(e => {
            console.error(`[auto-start] Production failed for ${script.rowId}:`, e.message);
          });
        });

        return res.status(200).json({ workflow, started: readyScripts.length });
      }

      case "performance-check": {
        const resp = await axios.post(`${baseUrl}/api/lore/performance-check`, {}, { headers });
        return res.status(200).json({ workflow, result: resp.data });
      }

      case "comments": {
        const resp = await axios.post(`${baseUrl}/api/lore/comments`, {}, { headers });
        return res.status(200).json({ workflow, result: resp.data });
      }

      default:
        return res.status(400).json({ error: `Unknown workflow: ${workflow}` });
    }
  } catch (e) {
    console.error(`[cron-lore] ${workflow} failed:`, e.message);
    return res.status(500).json({ error: e.message, workflow });
  }
};
```

- [ ] **Step 2: Update vercel.json — add function glob + cron schedules**

**Critical:** The existing `"functions": { "api/*.js": { "maxDuration": 60 } }` does NOT match `api/lore/*.js`. Update to:

```json
{
  "functions": {
    "api/*.js": { "maxDuration": 60 },
    "api/lore/*.js": { "maxDuration": 60 }
  }
}
```

Add these cron entries to the `crons` array:

```json
{ "path": "/api/lore/cron-lore?workflow=analytics", "schedule": "0 1 * * 1" },
{ "path": "/api/lore/cron-lore?workflow=weekly-batch", "schedule": "0 2 * * 1" },
{ "path": "/api/lore/cron-lore?workflow=auto-start", "schedule": "0 11 * * 1" },
{ "path": "/api/lore/cron-lore?workflow=performance-check", "schedule": "0 15 * * *" },
{ "path": "/api/lore/cron-lore?workflow=comments", "schedule": "0 * * * *" }
```

Times are UTC:
- Sun 8PM EST = Mon 01:00 UTC → analytics
- Sun 9PM EST = Mon 02:00 UTC → weekly-batch
- Mon 6AM EST = Mon 11:00 UTC → auto-start
- Daily 10AM EST = 15:00 UTC → performance-check
- Hourly → comments

- [ ] **Step 3: Commit**

```bash
git add api/lore/cron-lore.js vercel.json
git commit -m "feat(lore): add cron dispatcher + vercel.json schedules for all workflows"
```

---

### Task 20: Environment Variables Documentation

**Files:**
- Create: `api/lore/.env.example`

- [ ] **Step 1: Create .env.example for all Sports Lore credentials**

```bash
# === Sports Lore Pipeline ===
# Copy to .env and fill in values

# YouTube Data API + Analytics (OAuth2)
YOUTUBE_API_KEY=
YOUTUBE_ACCESS_TOKEN=
YOUTUBE_REFRESH_TOKEN=
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_CHANNEL_ID=

# Creatomate (video rendering + thumbnails)
CREATOMATE_API_KEY=
CREATOMATE_THUMBNAIL_TEMPLATE_ID=
CREATOMATE_VIDEO_TEMPLATE_ID=

# ElevenLabs (text-to-speech voiceover)
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=

# Pexels (stock video clips)
PEXELS_API_KEY=

# Mubert (AI music generation — optional, $14/mo)
MUBERT_PAT=

# TikTok Content Posting API (optional)
TIKTOK_ACCESS_TOKEN=

# Instagram Graph API (optional)
INSTAGRAM_USER_ID=
INSTAGRAM_ACCESS_TOKEN=
```

- [ ] **Step 2: Commit**

```bash
git add api/lore/.env.example
git commit -m "docs(lore): add .env.example with all required credentials"
```

---

## Summary

| Task | Feature(s) | Files Created |
|------|-----------|---------------|
| 1 | #14 Schema | `api/lore/lib/kv-lore.js` |
| 2 | Core | `api/lore/lib/claude.js` |
| 3 | #1 Metadata | `api/lore/generate-metadata.js` |
| 4 | #7 Hook | `api/lore/optimize-hook.js` |
| 5 | #15 Music | `api/lore/lib/music.js`, `api/lore/select-music.js` |
| 6 | #5, #3 Clips | `api/lore/clip-sourcer.js` |
| 7 | Orchestrator | `api/lore/weekly-batch.js` |
| 8 | #4 Batch | `api/lore/batch-control.js` |
| 9 | #9 Post Time | `api/lore/lib/post-times.js`, `api/lore/post-schedule.js` |
| 10 | #6 Analytics | `api/lore/lib/youtube-api.js`, `api/lore/analytics.js` |
| 11 | #8 A/B Test | `api/lore/ab-test.js` |
| 12 | #2 Thumbnail | `api/lore/lib/creatomate.js`, `api/lore/generate-thumbnail.js` |
| 13 | #12 Re-upload | `api/lore/performance-check.js` |
| 14 | #10 Cross-post | `api/lore/lib/cross-post.js`, `api/lore/cross-post.js` |
| 15 | #11 Comments | `api/lore/comments.js` |
| 16 | #3 Feedback | `api/lore/clip-feedback.js` |
| 17 | #13 Fallback | `api/lore/render-fallback.js` |
| 18 | Production | `api/lore/lib/elevenlabs.js`, `api/lore/video-production.js` |
| 19 | Cron | `api/lore/cron-lore.js`, `vercel.json` |
| 20 | Docs | `api/lore/.env.example` |

**Total: 22 new files, 1 modified file (vercel.json), 20 tasks, ~20 commits**
