# Results Tracking & Deep-Research Refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add daily pick grading with a yesterday's-results UI panel and running W-L record, plus overhaul refresh.js with deep per-player research.

**Architecture:** Five independent changes applied in order: (1) vercel.json config, (2) refresh.js archive + prompt rewrite, (3) new grade.js cron endpoint, (4) new results.js read endpoint, (5) frontend W-L tile + results section. Each task is independently deployable and testable via curl.

**Tech Stack:** Node.js (CommonJS), Vercel Serverless Functions, Vercel KV (Upstash Redis REST), `@anthropic-ai/sdk` with `web_search_20250305` tool, vanilla JS frontend.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `vercel.json` | Modify | maxDuration 120 → 300, add grade cron |
| `api/refresh.js` | Modify | Archive step before save + deep-research prompt rewrite |
| `api/grade.js` | Create | Daily grading cron endpoint |
| `api/results.js` | Create | GET endpoint serving pre-graded results from KV |
| `public/index.html` | Modify | Sixth stat tile (W-L), yesterday's results section |

---

## Task 1: Update vercel.json

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Read the current vercel.json**

Open `vercel.json`. It currently has:
```json
{
  "version": 2,
  "functions": { "api/*.js": { "maxDuration": 120 } },
  "crons": [
    { "path": "/api/cron", "schedule": "0 17 * * *" },
    { "path": "/api/cron", "schedule": "0 21 * * *" },
    { "path": "/api/cron", "schedule": "0 2 * * *" }
  ],
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/public/index.html" }
  ]
}
```

- [ ] **Step 2: Apply changes**

Replace `maxDuration` with 300 and add the grade cron entry:
```json
{
  "version": 2,
  "functions": { "api/*.js": { "maxDuration": 300 } },
  "crons": [
    { "path": "/api/cron",  "schedule": "0 17 * * *" },
    { "path": "/api/cron",  "schedule": "0 21 * * *" },
    { "path": "/api/cron",  "schedule": "0 2 * * *"  },
    { "path": "/api/grade", "schedule": "0 15 * * *" }
  ],
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/public/index.html" }
  ]
}
```

- [ ] **Step 3: Verify JSON is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('OK')"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add vercel.json
git commit -m "config: increase maxDuration to 300s, add grade cron at 15:00 UTC"
```

---

## Task 2: Update refresh.js — archive step + deep-research prompt

**Files:**
- Modify: `api/refresh.js`

- [ ] **Step 1: Add the archive step before the Claude call**

Inside the `try` block in `api/refresh.js`, directly after `console.log("[refresh] Starting AI analysis...")` and before `client.messages.create(...)`, insert:

```js
// Archive current picks before overwriting
const prev = await kv.get("picks:latest");
if (prev) {
  const picksForDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  await kv.set("picks:previous", { ...prev, picksForDate }, 86400 * 2);
  console.log("[refresh] Archived picks:latest to picks:previous for date", picksForDate);
}
```

`en-CA` locale produces `YYYY-MM-DD` format reliably. `America/Los_Angeles` keeps dates consistent with PT.

- [ ] **Step 2: Replace the prompt and increase max_tokens**

Replace the entire `client.messages.create({...})` call's `model`, `max_tokens`, and `messages` with:

```js
const response = await client.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 16000,
  tools: [{ type: "web_search_20250305", name: "web_search" }],
  messages: [{
    role: "user",
    content: `Today is ${today}. You are a sharp sports analyst finding the 12 best PrizePicks edges using deep research. Work through these phases carefully:

PHASE 1 — Find today's PrizePicks lines:
- Search "lineups.com PrizePicks today" and record every player, stat, and line you find
- Search "PrizePicks slate today ${today}" to cross-reference
- Build a candidate list of 20-30 players with their exact PrizePicks lines

PHASE 2 — Deep research on each candidate (do ALL of these searches):
For each candidate player:
- Search "[player name] last 10 games stats [sport]"
- Search "[player name] injury status today"
- Search "[player name] vs [tonight's opponent] history"
- Search "[team name] defensive ranking vs [player position]"
- Search "rotowire [player name] projection today"

PHASE 3 — Cross-reference and select:
- Compare RotoWire projections vs PrizePicks lines — projection above line = OVER edge, below = UNDER edge
- Only include a pick if at least 2 sources support the edge
- Rank by edge size (projection vs line gap) and pick the 12 absolute best

You MUST respond with ONLY a JSON array — no text before or after, no explanation, just the raw JSON array starting with [ and ending with ].

Each object must have exactly these fields:
- player (string): full name
- team (string): team abbreviation
- sport (string): NBA, MLB, NHL, etc.
- stat (string): e.g. "Points", "Rebounds", "Strikeouts"
- line (number): the actual PrizePicks line
- direction (string): "OVER" or "UNDER"
- confidence (integer 60-95): scale with edge size — 90+ only if gap is very large and multiple sources agree
- reasoning (string): MUST include last 5 and 10 game averages, opponent defensive ranking, any injury/rest info, the RotoWire or expert projection vs the PrizePicks line, and specifically why this line is mispriced
- tags (array of strings): include "RotoWire Edge" if projection found, "Confirmed Line" if from lineups.com, "Approximate Line" if estimated`,
  }],
});
```

- [ ] **Step 3: Verify syntax**

```bash
node -c api/refresh.js && echo "OK"
```
Expected: `OK`

- [ ] **Step 4: Smoke-test locally that the archive step doesn't break flow**

```bash
node -e "
const kv = require('./api/_kv');
async function test() {
  // Simulate what refresh does: get current picks:latest
  const prev = await kv.get('picks:latest');
  console.log('picks:latest exists:', prev !== null);
  const picksForDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  console.log('picksForDate would be:', picksForDate);
}
test().catch(console.error);
"
```
Expected output: `picks:latest exists: false` (no KV in local env) and a valid date string like `2026-03-26`.

- [ ] **Step 5: Commit**

```bash
git add api/refresh.js
git commit -m "feat: refresh.js — archive to picks:previous before overwrite, deep-research prompt, 12 picks, 16k tokens"
```

---

## Task 3: Create api/grade.js

**Files:**
- Create: `api/grade.js`

- [ ] **Step 1: Create the file**

Create `api/grade.js` with this complete implementation:

```js
const Anthropic = require("@anthropic-ai/sdk");
const kv = require("./_kv");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Auth: Vercel injects Authorization: Bearer $CRON_SECRET for cron jobs
  const authHeader = req.headers.authorization;
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  console.log("[grade] Running at", new Date().toISOString());

  try {
    // Step 1: Read picks:previous
    const previous = await kv.get("picks:previous");
    if (!previous || !previous.picks || previous.picks.length === 0) {
      console.log("[grade] picks:previous not found — refresh may not have run");
      return res.status(200).json({ ok: true, skipped: true, reason: "no previous picks" });
    }

    // Step 2: Determine the date these picks were for
    const picksForDate = previous.picksForDate || (() => {
      // Fallback: yesterday in PT
      const d = new Date(Date.now() - 86400000);
      return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    })();

    console.log("[grade] Grading picks for date:", picksForDate);

    // Step 3: Idempotency check — skip if already graded
    const existingResults = await kv.get(`picks:results:${picksForDate}`);
    if (existingResults) {
      console.log("[grade] Already graded for", picksForDate, "— skipping");
      return res.status(200).json({ ok: true, skipped: true, reason: "already graded" });
    }

    // Step 4: Single Claude call to look up all actual box scores
    const playerList = previous.picks
      .map(p => `${p.player} ${p.stat}`)
      .join(", ");

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{
        role: "user",
        content: `Find the actual stat lines for these players from games played on ${picksForDate}: ${playerList}.

Search "NBA box scores ${picksForDate}", "MLB box scores ${picksForDate}", and "[player name] stats ${picksForDate}" for any players whose sport is unclear.

For each player, return their actual stat total. If a player did not play or their game was postponed, note that.

Return ONLY a JSON object — no text, no explanation. Keys are exact player names, values are objects:
{ "actual": <number or null>, "note": "<brief note e.g. scored 28 pts, or did not play>" }

Example:
{
  "LeBron James": { "actual": 28, "note": "28 points vs PHX" },
  "Joel Embiid": { "actual": null, "note": "Did not play — knee injury" }
}`,
      }],
    });

    let rawText = "";
    for (const block of response.content || []) {
      if (block.type === "text") rawText += block.text;
    }

    console.log("[grade] Raw AI response:", rawText.slice(0, 500));

    // Parse the actuals object
    let actuals = {};
    const cleaned = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { actuals = JSON.parse(objMatch[0]); } catch (e) {
        console.error("[grade] Failed to parse actuals:", e.message);
      }
    }

    // Step 5: Grade each pick
    let wins = 0;
    let losses = 0;

    const gradedPicks = previous.picks.map(pick => {
      const result = actuals[pick.player];
      const actual_value = result?.actual ?? null;

      if (actual_value === null) {
        return {
          ...pick,
          hit: null,
          actual_value: null,
          difference: null,
          reasoning: result?.note || "Game not found or player did not play",
        };
      }

      const hit =
        (pick.direction === "OVER"  && actual_value > pick.line) ||
        (pick.direction === "UNDER" && actual_value < pick.line);

      const difference = parseFloat((actual_value - pick.line).toFixed(1));

      if (hit) wins++; else losses++;

      return {
        ...pick,
        hit,
        actual_value,
        difference,
        reasoning: result?.note || `${pick.direction === "OVER" ? "Needed >" : "Needed <"} ${pick.line}, got ${actual_value}`,
      };
    });

    // Sort: hits first, misses second, nulls last
    gradedPicks.sort((a, b) => {
      const order = v => v === true ? 0 : v === false ? 1 : 2;
      return order(a.hit) - order(b.hit);
    });

    // Step 7: Write results FIRST (idempotency key)
    const resultsPayload = {
      date: picksForDate,
      gradedAt: new Date().toISOString(),
      picks: gradedPicks,
      wins,
      losses,
    };
    await kv.set(`picks:results:${picksForDate}`, resultsPayload, 86400 * 30);
    console.log("[grade] Wrote picks:results:", picksForDate, `${wins}W-${losses}L`);

    // Step 8: Update running record AFTER results are written
    const record = await kv.get("picks:record") || { wins: 0, losses: 0 };
    const updatedRecord = {
      wins: record.wins + wins,
      losses: record.losses + losses,
      lastUpdated: new Date().toISOString(),
    };
    await kv.set("picks:record", updatedRecord);
    console.log("[grade] Updated picks:record:", updatedRecord);

    return res.status(200).json({ ok: true, wins, losses, total: gradedPicks.length });

  } catch (err) {
    console.error("[grade] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
```

- [ ] **Step 2: Verify syntax**

```bash
node -c api/grade.js && echo "OK"
```
Expected: `OK`

- [ ] **Step 3: Verify it loads without errors**

```bash
node -e "require('./api/grade.js'); console.log('module loads OK')"
```
Expected: `module loads OK`

- [ ] **Step 4: Commit**

```bash
git add api/grade.js
git commit -m "feat: add api/grade.js — daily cron to grade previous picks against box scores"
```

---

## Task 4: Create api/results.js

**Files:**
- Create: `api/results.js`

- [ ] **Step 1: Create the file**

Create `api/results.js` with this complete implementation:

```js
const kv = require("./_kv");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Compute yesterday in PT
  const yesterdayStr = new Date(Date.now() - 86400000)
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

  try {
    const [results, record] = await Promise.all([
      kv.get(`picks:results:${yesterdayStr}`),
      kv.get("picks:record"),
    ]);

    return res.status(200).json({
      results: results || null,
      record: record || { wins: 0, losses: 0 },
      // Use stored date when available to avoid clock-skew mismatch
      date: results?.date || yesterdayStr,
    });

  } catch (err) {
    console.error("[results] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
```

- [ ] **Step 2: Verify syntax and loading**

```bash
node -c api/results.js && node -e "require('./api/results.js'); console.log('OK')"
```
Expected: `OK`

- [ ] **Step 3: Verify the endpoint responds correctly after deploy**

After deploying, run:
```bash
curl -s https://prizepicks-edge.vercel.app/api/results | head -c 200
```
Expected: JSON like `{"results":null,"record":{"wins":0,"losses":0},"date":"2026-03-25"}` (no results yet, that's fine).

- [ ] **Step 4: Commit**

```bash
git add api/results.js
git commit -m "feat: add api/results.js — GET endpoint for yesterday's graded results and running record"
```

---

## Task 5: Update public/index.html — W-L tile and results section

**Files:**
- Modify: `public/index.html`

This task has three sub-steps: (a) add the sixth stat tile, (b) fetch `/api/results` in `loadPicks()`, (c) render the results section.

- [ ] **Step 1: Add the W-L stat tile to the HTML**

In `public/index.html`, find the stats hero section. It has five tiles ending with something like:
```html
<div class="hero-card" ...>
  <div class="hero-label">PROPS SCANNED</div>
  <div class="hero-val" id="h-scanned">—</div>
</div>
```
Add a sixth tile immediately after it:
```html
<div class="hero-card">
  <div class="hero-label">W-L RECORD</div>
  <div class="hero-val" id="h-record">—</div>
</div>
```

- [ ] **Step 2: Add the results section container to the HTML**

Find the closing `</div>` of the main picks grid (look for `id="main"` or the picks container). After it, add:
```html
<div id="results-section" style="display:none">
  <div class="section-header">
    <span class="section-title">Yesterday's Results</span>
    <span id="results-date" class="section-sub"></span>
    <span id="results-record-badge" class="record-badge"></span>
  </div>
  <div id="results-grid"></div>
</div>
```

- [ ] **Step 3: Add CSS for the results section**

In the `<style>` block, add:
```css
#results-section { margin: 24px 0 40px; }
.section-header { display:flex; align-items:center; gap:12px; margin-bottom:16px; }
.section-title { font-size:13px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--lime); }
.section-sub { font-size:12px; color:rgba(255,255,255,0.4); }
.record-badge { font-size:12px; font-weight:700; padding:2px 10px; border-radius:20px; background:rgba(255,255,255,0.08); color:#fff; }
.result-card { display:flex; align-items:flex-start; gap:12px; padding:12px 16px; background:var(--card); border-radius:10px; margin-bottom:8px; }
.result-icon { font-size:18px; flex-shrink:0; margin-top:2px; }
.result-body { flex:1; min-width:0; }
.result-player { font-size:13px; font-weight:700; }
.result-line { font-size:12px; margin-top:2px; }
.result-hit  { color:#4ade80; }
.result-miss { color:#f87171; }
.result-null { color:rgba(255,255,255,0.3); }
.result-reason { font-size:11px; color:rgba(255,255,255,0.45); margin-top:4px; }
```

- [ ] **Step 4: Update loadPicks() to fetch /api/results in parallel**

Find the `loadPicks()` function. It currently starts with:
```js
async function loadPicks(){
  try{
    const r=await fetch('/api/picks');
```

Change it to fetch both endpoints in parallel:
```js
async function loadPicks(){
  try{
    const [r, rr] = await Promise.all([
      fetch('/api/picks'),
      fetch('/api/results'),
    ]);
    if(!r.ok) throw new Error('Server error '+r.status);
    const d = await r.json();
    const dr = rr.ok ? await rr.json() : { results: null, record: { wins: 0, losses: 0 } };
```

Then update the W-L tile population. Find the block that sets the other hero tiles (look for `set('h-total'`, `set('h-overs'`, etc.) and add after them:
```js
const rec = dr.record || {};
set('h-record', (rec.wins != null && rec.losses != null) ? rec.wins+'-'+rec.losses : '—');
```

Then at the end of `loadPicks()`, before the closing `}catch`, add a call to render the results section:
```js
renderResults(dr);
```

- [ ] **Step 5: Add renderResults() function**

Add this function to the script section (after `loadPicks`):
```js
function renderResults(dr) {
  const section = document.getElementById('results-section');
  const grid = document.getElementById('results-grid');
  if (!dr || !dr.results || !dr.results.picks) {
    section.style.display = 'none';
    return;
  }
  const r = dr.results;
  const wins = r.wins || 0;
  const losses = r.losses || 0;
  const dateStr = r.date ? new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric' }) : '';
  document.getElementById('results-date').textContent = dateStr;
  document.getElementById('results-record-badge').textContent = wins + '-' + losses + ' yesterday';

  grid.innerHTML = r.picks.map(p => {
    const icon   = p.hit === true ? '✅' : p.hit === false ? '❌' : '➖';
    const cls    = p.hit === true ? 'result-hit' : p.hit === false ? 'result-miss' : 'result-null';
    const dir    = p.direction === 'OVER' ? 'O' : 'U';
    const actual = p.actual_value != null ? p.actual_value : '—';
    const lineStr = `<span class="${cls}">${dir} ${p.line} → ${actual}</span>`;
    return `<div class="result-card">
      <div class="result-icon">${icon}</div>
      <div class="result-body">
        <div class="result-player">${p.player} · ${p.stat}</div>
        <div class="result-line">${lineStr}</div>
        <div class="result-reason">${p.reasoning || ''}</div>
      </div>
    </div>`;
  }).join('');

  section.style.display = 'block';
}
```

- [ ] **Step 6: Verify the page loads without JS errors**

Open `public/index.html` in a browser (or use `vercel dev`) and open the browser console. There should be no JS errors on load. The W-L tile should show `—` (no data yet). The results section should be hidden.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: add W-L record tile and yesterday's results section to frontend"
```

---

## Task 6: Push and verify deployment

- [ ] **Step 1: Push all commits**

```bash
git push
```

- [ ] **Step 2: Verify deployment builds cleanly**

```bash
npx vercel ls 2>/dev/null | head -5
```
Check the latest deployment shows status `● Ready`.

- [ ] **Step 3: Verify all four API endpoints respond**

```bash
curl -s https://prizepicks-edge.vercel.app/api/results
curl -s https://prizepicks-edge.vercel.app/api/status
curl -s -X POST https://prizepicks-edge.vercel.app/api/refresh -H "x-secret: picks25" -w "\nHTTP %{http_code}\n"
```

Expected:
- `/api/results` → `{"results":null,"record":{"wins":0,"losses":0},"date":"..."}`
- `/api/status` → `{"ok":true,...}`
- `/api/refresh` → eventually `{"ok":true,"total":12}` (will take ~2-4 minutes due to deep research)

- [ ] **Step 4: Verify picks:previous is being set after a refresh**

After `/api/refresh` completes successfully, trigger a second refresh and check Vercel logs for the line:
```
[refresh] Archived picks:latest to picks:previous for date 2026-03-26
```

- [ ] **Step 5: Manually trigger grade to verify it works**

```bash
curl -s -X POST https://prizepicks-edge.vercel.app/api/grade \
  -H "Authorization: Bearer picks25"
```
Expected first time: `{"ok":true,"skipped":true,"reason":"no previous picks"}` (or graded results if picks:previous exists from a prior refresh).

---

## Notes

**No test framework is present in this project.** Verification is done via `node -c` syntax checks, module load checks, and curl against the live deployment. The integration test is real end-to-end: run refresh, verify KV was written, run grade, verify results appear in the UI.

**grade.js will skip gracefully** on the first few runs until picks:previous has been populated by at least one successful refresh. This is expected behavior.

**The deep-research prompt takes 2-4 minutes.** This is by design (quality over speed). The Vercel function timeout is now 300s which is sufficient.
