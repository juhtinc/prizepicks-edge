# Professional Upgrade — Expanded Sports, CLV Tracking, Sharp Picks, Bankroll, News Ticker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand pick quality and coverage across 5 new sport verticals, add CLV (Closing Line Value) tracking, surface sharp-money signals on the frontend, give users a personal bankroll tracker with Kelly stake sizing, and add a live injury news ticker.

**Architecture:** Five sequentially applied changes. Task 1 expands refresh.js (prompt + correlation post-processing). Task 2 adds frontend tiles, bankroll modal, Kelly stake, sharp picks section, news ticker UI. Task 3 adds CLV computation to grade.js and exposes it from results.js. Task 4 creates api/news.js. Task 5 pushes and verifies. Each task is independently deployable and testable.

**Tech Stack:** Node.js (CommonJS), Vercel Serverless Functions, Vercel KV (Upstash Redis REST), `@anthropic-ai/sdk` with `web_search_20250305` tool, vanilla JS frontend.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `api/refresh.js` | Modify | Expanded 3-phase prompt (new sports, new research, new JSON fields, 15 picks), correlation post-processing |
| `api/grade.js` | Modify | CLV lookup Claude call + CLV record KV writes after existing record update |
| `api/results.js` | Modify | Add `picks:clv_record` KV read, include `clv_record` in response JSON |
| `api/news.js` | Create | New endpoint: AI-powered injury/lineup news, cached 30 min in KV |
| `public/index.html` | Modify | Win Rate + Avg CLV hero tiles, bankroll bar + modal, Kelly stake, correlation badge, sharp picks section, news ticker |

---

## Task 1: Expand refresh.js — new sports, richer research, new JSON fields, correlation post-processing

**Files:**
- Modify: `api/refresh.js`

- [ ] **Step 1: Read api/refresh.js**

Read the current file to confirm the structure before making changes.

- [ ] **Step 2: Replace the prompt content**

In `api/refresh.js`, find the `messages` array inside `client.messages.create({...})`. Replace the entire `content` template literal with the new prompt below. Keep `model`, `max_tokens`, and `tools` unchanged.

```js
content: `Today is ${today}. You are a sharp sports analyst finding the 15 best PrizePicks edges using deep research across all available sports. Work through these phases carefully:

PHASE 1 — Find today's PrizePicks lines (search in this priority order):
1. Search "lineups.com PrizePicks today" — primary source
2. Search "rotowire PrizePicks props today"
3. Search "reddit r/prizepicks slate today ${today}"
4. Search "Twitter PrizePicks props today" (look for @PrizePicks @PrizePicksProps @lineupshq)
5. Search "oddsjam prizepicks today" and "pickswise prizepicks today" and "bettingpros prizepicks today"
For tennis: also search "PrizePicks tennis props today" and "lineups.com prizepicks tennis" and "tennisabstract.com" and "atptour.com match today"
For esports: also search "PrizePicks esports props today" and "PrizePicks Valorant props today" and "PrizePicks Dota2 props today" and "vlr.gg today" and "gol.gg today" and "hltv.org today" and "dotabuff.com today"
For other sports: also search "PrizePicks golf props today" and "PrizePicks UFC props today" and "PrizePicks MLS soccer props today"
Build a candidate list of 25-35 players across NBA, MLB, NHL, Soccer/MLS, Tennis, Esports (Valorant/LoL/CS2/Dota2/Rocket League), Golf, and MMA/UFC with their exact PrizePicks lines.

PHASE 2 — Deep research on each candidate (do ALL of these for each player):
Standard research (all sports):
- Search "[player name] last 10 games stats [sport]"
- Search "[player name] injury status today"
- Search "[player name] vs [tonight's opponent] history"
- Search "[team name] defensive ranking vs [player position]"
- Search "rotowire [player name] projection today"
- Search "PrizePicks [player name] line movement today" — note if line has moved and in which direction
- Search "[player name] public betting percentage today" — note public split
- Search "Underdog Fantasy [player name] line today" and "Sleeper props [player name] today" — note alt lines
- Search "[team name] schedule context back to back rest" — flag trap games

For MLB/NFL only:
- Search "[city] [stadium] weather forecast today" — flag adverse weather (wind >15mph, rain, cold)

For Tennis specifically:
- Search "[player name] H2H vs [opponent]"
- Search "[player name] surface record [surface type]"
- Search "[player name] ATP/WTA ranking ace rate first serve percentage"

For Esports specifically:
- Search "[team name] recent match results [game]"
- Search "[player name] recent performance stats [game]"
- Search "tournament context [team name] [game] today"

PHASE 3 — Cross-reference and select 15 best picks:
- Compare projections vs PrizePicks lines
- Only include a pick if at least 2 sources support the edge
- Rank by edge size and pick the 15 absolute best across all sports

You MUST respond with ONLY a JSON array — no text before or after, no explanation, just the raw JSON array starting with [ and ending with ].

Each object must have exactly these fields:
- player (string): full name
- team (string): team abbreviation
- opponent (string|null): opponent team abbreviation, or null if unknown
- sport (string): NBA, MLB, NHL, Soccer, Tennis, Valorant, LoL, CS2, Dota2, RocketLeague, Golf, MMA, or other
- stat (string): e.g. "Points", "Rebounds", "Kills", "Aces", "Fantasy Score"
- line (number): the actual PrizePicks line
- line_open (number|null): opening line if found via line movement search, else null
- direction (string): "OVER" or "UNDER"
- confidence (integer 60-95): scale with edge size — 90+ only if gap is very large and multiple sources agree
- sharp_move (boolean|null): true if line moved >1 point in our direction, false if moved against, null if unknown
- public_fade (boolean|null): true if public is 75%+ on the OTHER side (we are fading public), else null
- public_pct (integer|null): percentage of public on OUR side (0-100), or null if unknown
- weather_flag (boolean|null): true if adverse weather detected for MLB/NFL, null for all other sports
- trap_game (boolean|null): true if schedule trap detected (back-to-back, travel, letdown spot), else null
- alt_lines (object|null): {"underdog": number|null, "sleeper": number|null} if found, else null
- reasoning (string): MUST include last 5 and 10 game averages, opponent context, projection vs line, line movement info, public split, and specifically why this line is mispriced. For tennis include H2H, surface, serve stats. For esports include team form and meta context.
- tags (array of strings): include "RotoWire Edge" if projection found, "Confirmed Line" if from lineups.com, "Approximate Line" if estimated, "Sharp Action" if sharp_move is true, "Fade Public" if public_fade is true, "Weather Factor" if weather_flag is true, "Trap Spot" if trap_game is true`,
```

- [ ] **Step 3: Add correlation post-processing after the JSON parse block**

In `api/refresh.js`, find the fallback parse block that ends with:
```js
    if (!picks) {
      try { picks = JSON.parse(cleaned); } catch (e) {
        console.error("[refresh] Full parse failed:", e.message);
      }
    }
```

Immediately after that block (before the `if (!Array.isArray(picks)...` error check), add the `detectCorrelations` function and call it:

```js
    function detectCorrelations(picks) {
      const gameGroups = {};
      for (const pick of picks) {
        const key = [pick.team, pick.opponent].filter(Boolean).sort().join(':');
        if (!key) continue;
        if (!gameGroups[key]) gameGroups[key] = [];
        gameGroups[key].push(pick);
      }
      for (const group of Object.values(gameGroups)) {
        if (group.length < 2) continue;
        for (const pick of group) {
          const teammates = group.filter(q => q !== pick && q.team === pick.team);
          const opponents = group.filter(q => q !== pick && q.team !== pick.team);
          if (teammates.length > 0) {
            pick.correlation = { group: `${pick.team} game`, note: "Same team — consider parlaying on a big game night" };
          } else if (opponents.length > 0) {
            pick.correlation = { group: `${pick.team} vs ${pick.opponent || 'Opponent'}`, note: "Opposing teams — game script dependent" };
          }
        }
      }
      return picks;
    }
    if (Array.isArray(picks)) picks = detectCorrelations(picks);
```

- [ ] **Step 4: Verify syntax**

```bash
node -c api/refresh.js && echo "OK"
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add api/refresh.js
git commit -m "feat: refresh.js — 5 new sports, 15 picks, new JSON fields (opponent/sharp_move/public_fade/weather/trap/alt_lines), correlation detection"
```

---

## Task 2: Frontend — Win Rate + CLV tiles, bankroll bar, Kelly stake, correlation badge, sharp picks section, news ticker

**Files:**
- Modify: `public/index.html`

This task has multiple sub-steps. Read the file before making changes.

- [ ] **Step 1: Read public/index.html**

Read the file, especially around lines 488-545 (hero section, toolbar, main div) and lines 590-830 (JS section).

- [ ] **Step 2: Add Win Rate and Avg CLV hero tiles**

Find the last hero tile line (currently `id="h-record"`):
```html
    <div class="hero-card"><div class="hc-label">W-L Record</div><div class="hc-val lime" id="h-record">—</div></div>
```
Add two tiles immediately after it (before the closing `</div>` of `.hero`):
```html
    <div class="hero-card"><div class="hc-label">Win %</div><div class="hc-val gold" id="h-roi">—</div></div>
    <div class="hero-card"><div class="hc-label">Avg CLV</div><div class="hc-val sky" id="h-clv">—</div></div>
```

- [ ] **Step 3: Add bankroll bar and modal HTML**

Find the `<!-- Toolbar -->` comment. Insert the following HTML immediately before `<div class="toolbar">`:

```html
  <div class="bankroll-bar" id="bankroll-bar">
    <span class="bankroll-label">💰 Bankroll:</span>
    <span id="bankroll-display">Not set</span>
    <button class="bankroll-edit" onclick="openBankrollModal()">Set</button>
  </div>
  <div id="bankroll-modal" class="modal-bg" style="display:none">
    <div class="modal-box">
      <div class="modal-title">Set Your Bankroll</div>
      <input type="number" id="bankroll-input" class="modal-input" placeholder="e.g. 1000" min="1"/>
      <div id="bankroll-err" class="modal-err" style="display:none"></div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeBankrollModal()">Cancel</button>
        <button class="btn-go" onclick="saveBankroll()">Save</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 4: Add sharp picks section HTML**

Find `<div id="main"></div>`. Insert the sharp picks section immediately before it:

```html
  <div id="sharp-section" style="display:none">
    <div class="section-header">
      <span class="section-title">⚡ Sharp Picks</span>
      <span class="section-sub">Line movement + public fade alignment</span>
    </div>
    <div id="sharp-grid" class="grid"></div>
  </div>
```

- [ ] **Step 5: Add news ticker HTML**

Find `<!-- Stats Hero -->`. Insert the news ticker immediately before `<div class="hero">`:

```html
  <div class="news-ticker">
    <span class="ticker-label">LIVE NEWS</span>
    <div class="ticker-wrap">
      <div class="ticker-track" id="ticker-track">
        <span class="ticker-item">Loading injury news...</span>
      </div>
    </div>
  </div>
```

- [ ] **Step 6: Add all new CSS**

In the `<style>` block, add the following CSS before the closing `</style>` tag:

```css
.bankroll-bar { display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--ink2); border:1px solid var(--line); border-radius:var(--rs); margin-bottom:12px; font-size:12px; }
.bankroll-label { color:rgba(255,255,255,0.5); }
.bankroll-edit { font-size:11px; color:var(--lime); background:transparent; border:1px solid rgba(184,245,66,0.3); padding:2px 8px; border-radius:4px; cursor:pointer; }
.kelly-stake { font-size:11px; color:var(--gold); margin-top:6px; font-family:'JetBrains Mono',monospace; }
.corr-badge { font-size:10px; color:var(--violet); background:rgba(192,132,252,0.12); padding:3px 8px; border-radius:4px; margin-top:4px; display:inline-block; }
.news-ticker { display:flex; align-items:center; gap:12px; background:var(--ink2); border:1px solid var(--line); border-radius:var(--rs); padding:8px 12px; margin-bottom:20px; overflow:hidden; height:36px; }
.ticker-label { font-size:9px; letter-spacing:2px; text-transform:uppercase; color:var(--lime); font-weight:700; white-space:nowrap; flex-shrink:0; }
.ticker-wrap { flex:1; overflow:hidden; }
.ticker-track { white-space:nowrap; }
.ticker-track span { display:inline-block; animation:ticker-scroll 60s linear infinite; font-size:12px; color:var(--text); opacity:0.75; }
.ticker-item { color:rgba(255,255,255,0.3); font-size:12px; }
@keyframes ticker-scroll { 0%{transform:translateX(100vw)} 100%{transform:translateX(-100%)} }
```

- [ ] **Step 7: Add bankroll JS before loadPicks()**

In the `<script>` block, find the `// ── Fetch picks` comment (which precedes `async function loadPicks()`). Insert the following JS immediately before that comment:

```js
// ── Bankroll ───────────────────────────────────────────
let BANKROLL = parseFloat(localStorage.getItem('bankroll')) || 0;

function updateBankrollDisplay() {
  document.getElementById('bankroll-display').textContent = BANKROLL > 0 ? '$' + BANKROLL.toLocaleString() : 'Not set';
}
function openBankrollModal() {
  document.getElementById('bankroll-input').value = BANKROLL || '';
  document.getElementById('bankroll-err').style.display = 'none';
  document.getElementById('bankroll-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('bankroll-input').focus(), 50);
}
function closeBankrollModal() { document.getElementById('bankroll-modal').style.display = 'none'; }
function saveBankroll() {
  const val = parseFloat(document.getElementById('bankroll-input').value);
  if (!val || val <= 0) {
    const e = document.getElementById('bankroll-err');
    e.textContent = 'Enter a positive number'; e.style.display = 'block'; return;
  }
  BANKROLL = val;
  localStorage.setItem('bankroll', val);
  closeBankrollModal();
  updateBankrollDisplay();
  render();
}
function kellyStake(confidence) {
  if (!BANKROLL) return null;
  return Math.max(0, Math.round((confidence / 100 * 2 - 1) * BANKROLL * 0.25 * 100) / 100);
}
updateBankrollDisplay();

```

- [ ] **Step 8: Populate Win Rate and CLV tiles in loadPicks()**

In `loadPicks()`, find the line that sets `h-record`:
```js
    set('h-record', (rec.wins != null && rec.losses != null) ? rec.wins+'-'+rec.losses : '—');
```
Add the following immediately after that line:

```js
    const recW = rec.wins || 0;
    const recL = rec.losses || 0;
    const recTotal = recW + recL;
    if (recTotal > 0) {
      const winRate = (recW / recTotal * 100).toFixed(1);
      set('h-roi', winRate + '%');
    } else { set('h-roi', '—'); }
    const clvAvg = dr.clv_record?.avg;
    set('h-clv', clvAvg != null ? (clvAvg >= 0 ? '+' : '') + clvAvg.toFixed(2) : '—');
```

- [ ] **Step 9: Add Kelly stake and correlation badge inside cardHTML()**

In `cardHTML(p, i)`, find:
```js
  <div class="tags">${tg}</div>
```
Replace with:
```js
  <div class="tags">${tg}</div>
    ${(()=>{const s=kellyStake(p.confidence);return s!=null?`<div class="kelly-stake">Recommended: $${s.toFixed(2)}</div>`:''})()}
    ${p.correlation?`<div class="corr-badge">${p.correlation.note}</div>`:''}
```

- [ ] **Step 10: Add renderSharpSection() and call it from render()**

Add the following function immediately after `renderResults(dr)`:

```js
function renderSharpSection() {
  const section = document.getElementById('sharp-section');
  const grid = document.getElementById('sharp-grid');
  let idx = 1000;
  const sharp = ALL.filter(p =>
    p.sharp_move === true ||
    (p.tags && (p.tags.includes('Sharp Action') || p.tags.includes('Fade Public')))
  );
  if (sharp.length === 0) { section.style.display = 'none'; return; }
  grid.innerHTML = sharp.map(p => cardHTML(p, idx++)).join('');
  section.style.display = 'block';
}
```

In `render()`, add a call to `renderSharpSection()` at the very end, before the closing `}`:
```js
  renderSharpSection();
```

- [ ] **Step 11: Add news ticker JS before the loadPicks() call at bottom**

Find the `loadPicks();` call near the end of the script. Add the following immediately before it:

```js
async function loadNews() {
  try {
    const r = await fetch('/api/news');
    if (!r.ok) return;
    const d = await r.json();
    const items = d.items || [];
    if (!items.length) return;
    const track = document.getElementById('ticker-track');
    const text = items.map(i => `[${i.sport}] ${i.text}  ·  `).join('');
    track.innerHTML = `<span>${text}</span>`;
  } catch(e) { console.warn('[ticker]', e.message); }
}
loadNews();
setInterval(loadNews, 30 * 60 * 1000);

```

- [ ] **Step 12: Verify no JS errors**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
console.log('Script length:', m[1].length, 'chars — OK');
"
```

- [ ] **Step 13: Commit**

```bash
git add public/index.html
git commit -m "feat: Win Rate + CLV tiles, bankroll modal, Kelly stakes, correlation badges, sharp picks section, news ticker UI"
```

---

## Task 3: CLV tracking in grade.js + results.js

**Files:**
- Modify: `api/grade.js`
- Modify: `api/results.js`

- [ ] **Step 1: Read both files**

Read `api/grade.js` and `api/results.js` to understand current structure.

- [ ] **Step 2: Add CLV block to grade.js**

In `api/grade.js`, find:
```js
    console.log("[grade] Updated picks:record:", updatedRecord);
```
Add the following CLV tracking block immediately after that log line and before `return res.status(200).json(...)`:

```js
    // CLV tracking (non-fatal — wrapped in try/catch)
    try {
      const clvPlayerList = gradedPicks
        .filter(p => p.hit !== null)
        .map(p => `${p.player} ${p.stat}`)
        .join(", ");

      if (clvPlayerList) {
        const clvResp = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{
            role: "user",
            content: `What were the closing PrizePicks lines for these players on ${picksForDate}: ${clvPlayerList}?
Search "PrizePicks closing lines ${picksForDate}" and "lineups.com PrizePicks ${picksForDate}".
Return ONLY a JSON object — keys are exact player names, values are closing line numbers (or null):
{"LeBron James": 25.5, "Joel Embiid": null}`,
          }],
        });

        let clvRaw = "";
        for (const b of clvResp.content || []) { if (b.type === "text") clvRaw += b.text; }

        let closingLines = {};
        const clvCleaned = clvRaw.replace(/```json/gi,"").replace(/```/g,"").trim();
        const clvMatch = clvCleaned.match(/\{[\s\S]*\}/);
        if (clvMatch) {
          try { closingLines = JSON.parse(clvMatch[0]); } catch(e) {
            console.error("[grade] CLV parse:", e.message);
          }
        }

        let clvPos = 0, clvNeg = 0, clvPts = 0;
        for (const pick of gradedPicks) {
          const closing = closingLines[pick.player];
          if (closing == null) { pick.clv = null; continue; }
          pick.clv = pick.direction === "OVER"
            ? parseFloat((closing - pick.line).toFixed(2))
            : parseFloat((pick.line - closing).toFixed(2));
          if (pick.clv > 0) clvPos++; else clvNeg++;
          clvPts += pick.clv;
        }

        // Re-save results with CLV data added
        resultsPayload.picks = gradedPicks;
        await kv.set(`picks:results:${picksForDate}`, resultsPayload, 86400 * 30);

        const clvRecord = await kv.get("picks:clv_record") || { positive: 0, negative: 0, total_pts: 0 };
        const newClv = {
          positive: clvRecord.positive + clvPos,
          negative: clvRecord.negative + clvNeg,
          total_pts: parseFloat((clvRecord.total_pts + clvPts).toFixed(2)),
          lastUpdated: new Date().toISOString(),
        };
        const clvTotal = newClv.positive + newClv.negative;
        newClv.avg = clvTotal > 0 ? parseFloat((newClv.total_pts / clvTotal).toFixed(2)) : 0;
        await kv.set("picks:clv_record", newClv);
        console.log("[grade] CLV record:", newClv);
      }
    } catch (clvErr) {
      console.error("[grade] CLV step failed (non-fatal):", clvErr.message);
    }
```

- [ ] **Step 3: Update results.js to read and return clv_record**

In `api/results.js`, replace:
```js
    const [results, record] = await Promise.all([
      kv.get(`picks:results:${yesterdayStr}`),
      kv.get("picks:record"),
    ]);
```
With:
```js
    const [results, record, clvRecord] = await Promise.all([
      kv.get(`picks:results:${yesterdayStr}`),
      kv.get("picks:record"),
      kv.get("picks:clv_record"),
    ]);
```

And replace the `return res.status(200).json({...})` with:
```js
    return res.status(200).json({
      results: results || null,
      record: record || { wins: 0, losses: 0 },
      clv_record: clvRecord || { positive: 0, negative: 0, avg: 0 },
      date: results?.date || yesterdayStr,
    });
```

- [ ] **Step 4: Verify syntax on both files**

```bash
node -c api/grade.js && node -c api/results.js && echo "OK"
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add api/grade.js api/results.js
git commit -m "feat: CLV tracking in grade.js — closing line lookup, per-pick CLV, picks:clv_record; expose from results.js"
```

---

## Task 4: Create api/news.js — live injury/lineup news endpoint

**Files:**
- Create: `api/news.js`

- [ ] **Step 1: Create the file**

Create `api/news.js` with this complete implementation:

```js
const Anthropic = require("@anthropic-ai/sdk");
const kv = require("./_kv");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const cached = await kv.get("news:latest");
    if (cached) return res.status(200).json(cached);

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{
        role: "user",
        content: `Search for the 10 most recent sports injury updates and lineup news across NBA, MLB, NHL, and soccer.
Search: "NBA injury report today", "MLB lineup news today", "sports injury updates today".
Return ONLY a JSON array of exactly 10 items, most recent first:
[{"sport":"NBA","text":"LeBron James questionable vs PHX — knee soreness","time":"2h ago"}]`,
      }],
    });

    let rawText = "";
    for (const b of response.content || []) { if (b.type === "text") rawText += b.text; }
    let items = [];
    const cleaned = rawText.replace(/```json/gi,"").replace(/```/g,"").trim();
    const arr = cleaned.match(/\[[\s\S]*\]/);
    if (arr) { try { items = JSON.parse(arr[0]); } catch(e) { console.error("[news] parse:", e.message); } }
    if (!Array.isArray(items)) items = [];

    const payload = { items, fetchedAt: new Date().toISOString() };
    await kv.set("news:latest", payload, 1800);
    return res.status(200).json(payload);

  } catch (err) {
    console.error("[news] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
```

- [ ] **Step 2: Verify syntax and module load**

```bash
node -c api/news.js && node -e "require('./api/news.js'); console.log('module loads OK')"
```
Expected: `module loads OK`

- [ ] **Step 3: Commit**

```bash
git add api/news.js
git commit -m "feat: add api/news.js — 30-min cached injury/lineup news for frontend ticker"
```

---

## Task 5: Push and verify

- [ ] **Step 1: Push all commits**

```bash
git push
```

- [ ] **Step 2: Wait for deployment and verify all endpoints respond**

```bash
curl -s https://prizepicks-edge.vercel.app/api/results | head -c 300
curl -s https://prizepicks-edge.vercel.app/api/news | head -c 300
curl -s https://prizepicks-edge.vercel.app/api/picks | head -c 200
```

Expected:
- `/api/results` → JSON including `clv_record` key: `{"results":null,"record":{"wins":0,"losses":0},"clv_record":{"positive":0,"negative":0,"avg":0},"date":"..."}`
- `/api/news` → `{"items":[{"sport":"NBA","text":"...","time":"..."},...], "fetchedAt":"..."}`
- `/api/picks` → `{"picks":[...],"meta":{...}}`

- [ ] **Step 3: Run a refresh to verify new pick fields**

```bash
curl -s -X POST https://prizepicks-edge.vercel.app/api/refresh -H "x-secret: picks25" -w "\nHTTP %{http_code}\n"
```
Expected: eventually `{"ok":true,"total":15}` (takes 3–5 minutes with expanded research).

After it completes:
```bash
curl -s https://prizepicks-edge.vercel.app/api/picks | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const j=JSON.parse(d);
const p=j.picks[0];
const fields=['opponent','line_open','sharp_move','public_fade','public_pct','weather_flag','trap_game','alt_lines'];
fields.forEach(f=>console.log(f+':', JSON.stringify(p[f])));
"
```
Expected: each field is present (may be null if not found, but the key exists).

- [ ] **Step 4: Verify correlation detection**

```bash
curl -s https://prizepicks-edge.vercel.app/api/picks | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const j=JSON.parse(d);
const corr=j.picks.filter(p=>p.correlation);
console.log('Correlated picks:', corr.length);
if(corr.length) console.log('Example:', JSON.stringify(corr[0].correlation));
"
```

- [ ] **Step 5: Verify sharp picks section and bankroll in UI**

Open https://prizepicks-edge.vercel.app in browser. Confirm:
- 8 hero tiles visible (Total Picks, Overs, Unders, Avg Edge, Props Scanned, W-L Record, Win Rate, Avg CLV)
- Bankroll bar shows "Not set" with a Set button
- News ticker visible at top with injury news scrolling
- Set bankroll to 1000 → cards should show "Recommended: $X"
- Sharp Picks section visible if any picks have Sharp Action or Fade Public tags

---

## Notes

**No test framework is present in this project.** Verification is done via `node -c` syntax checks, module load checks, and curl against the live deployment.

**Prompt timeout.** The expanded research is significantly heavier. If refresh times out at 300s, reduce the Phase 1 candidate pool: change "25-35 players" to "18-22 players" and Phase 3 to "12 absolute best". The `max_tokens: 16000` limit is already correct.

**CLV stats populate on the next daily grade run.** The `Avg CLV` tile shows `—` until `api/grade` runs at 15:00 UTC and successfully finds closing lines.

**News ticker is lazy-loaded.** `loadNews()` runs independently of `loadPicks()`. If `/api/news` is slow or fails, the ticker silently stays at "Loading injury news..." — picks render normally. The 30-min KV cache prevents API overuse.

**Source note.** The `opponent` field depends on the AI correctly identifying tonight's opponent. If not found, it will be `null` and correlation detection will skip that pick (the `[pick.team, pick.opponent].filter(Boolean)` guards against this).
