# Results Tracking & Grading System — Design Spec
Date: 2026-03-26

## Overview
Two scoped changes:

1. **Results tracking** — daily grading system that grades yesterday's picks against actual box scores, displays hits/misses in the UI, and maintains a running win-loss record.
2. **Deep-research refresh** — overhaul of `refresh.js` to do per-player research before selecting picks, prioritizing accuracy over speed.

Autocorrection (adjusting future confidence based on past performance) is out of scope.

## Data Model

| KV Key | Contents | Written by | TTL |
|---|---|---|---|
| `picks:latest` | Current picks batch (unchanged) | refresh.js | 48h |
| `picks:previous` | Copy of picks:latest before overwrite, includes `picksForDate` | refresh.js | 48h |
| `picks:results:YYYY-MM-DD` | Graded results for that date | grade.js | 30 days |
| `picks:record` | `{ wins, losses, lastUpdated }` | grade.js | no expiry |

### picks:previous shape
`picks:previous` is a copy of the full `picks:latest` object with one additional field added at archive time:
```json
{
  "picksForDate": "2026-03-25",
  "picks": [...],
  "scrapedAt": "...",
  "analyzedAt": "...",
  "leaguesSeen": [...],
  "totalProps": 20
}
```
`picksForDate` is the calendar date (PT) at the time of archiving. grade.js uses this field as the results key date rather than computing "yesterday" from the clock, which eliminates clock-skew and manual-rerun ambiguity.

### picks:results shape
```json
{
  "date": "2026-03-25",
  "gradedAt": "2026-03-26T15:00:00Z",
  "picks": [
    {
      "player": "LeBron James",
      "team": "LAL",
      "sport": "NBA",
      "stat": "Points",
      "line": 24.5,
      "direction": "OVER",
      "confidence": 82,
      "hit": true,
      "actual_value": 28,
      "difference": 3.5,
      "reasoning": "Scored 28 points vs PHX. Exceeded 24.5 line by 3.5."
    }
  ],
  "wins": 14,
  "losses": 6
}
```
`hit` is `null` (not counted) if the player's game was not found or they did not play.

### picks:record shape
```json
{ "wins": 47, "losses": 23, "lastUpdated": "2026-03-26T15:00:00Z" }
```

## API Changes

### api/refresh.js — full rewrite

**Archive step (before fetching new picks):**
Copy `picks:latest` → `picks:previous` with a `picksForDate` field (today's date in PT, `YYYY-MM-DD`):
```js
const prev = await kv.get("picks:latest");
if (prev) {
  const picksForDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  await kv.set("picks:previous", { ...prev, picksForDate }, 86400 * 2);
}
```

**Deep-research prompt (replaces current single-prompt approach):**
- `max_tokens`: increased from 8000 to 16000
- The prompt instructs Claude to run multi-phase research before selecting picks:

  **Phase 1 — Find today's games and PrizePicks lines:**
  - Search `"lineups.com PrizePicks today"` for actual lines
  - Search `"PrizePicks slate today [date]"` to cross-reference

  **Phase 2 — Per-player deep research** (for each candidate pick):
  - `"[player name] last 10 games stats"`
  - `"[player name] injury status today"`
  - `"[player name] vs [opponent] history"`
  - `"[team] defensive ranking vs [position]"`
  - `"rotowire [player name] projection today"`

  **Phase 3 — Selection:** Only include a pick if at least 2 sources support the edge. Pick the 12 absolute best.

- `reasoning` field must include: last 5 and 10 game averages, opponent defensive ranking, any injury/rest notes, the RotoWire or expert projection vs the PrizePicks line, and a specific explanation of why the line is mispriced.

**vercel.json — increase maxDuration:**
Change `"api/*.js"` `maxDuration` from 120 to 300 to accommodate extended research time.

**Pick count:** Reduced from 20 to 12 (quality over quantity).

### api/grade.js — new endpoint
- **Method:** POST (called by Vercel cron)
- **Auth:** CRON_SECRET via Authorization header (same pattern as cron.js)
- **Schedule:** `0 15 * * *` UTC (7–8am PT depending on DST) in vercel.json
- **Idempotent:** Write results key before updating record so retries are safe

**Logic:**
1. Read `picks:previous` from KV. If missing, log `"[grade] picks:previous not found — refresh may not have run"` and exit with `{ ok: true, skipped: true }`.
2. Read `picksForDate` from the archived object. If missing, fall back to yesterday computed as `new Date(Date.now() - 86400000)` formatted `YYYY-MM-DD` with `timeZone: "America/Los_Angeles"` — consistent with all other date derivations in the system.
3. Check if `picks:results:${picksForDate}` already exists. If so, return early — already graded. This guard protects `picks:record` from double-counting on retries.
4. Make a **single Claude call** with web_search tool listing all players at once (e.g. `"Find the actual stat lines for these players from games on ${picksForDate}: LeBron James Points, Steph Curry Points, ..."`). A single call is required to stay within the 120s `maxDuration` limit — individual per-player calls would time out.
5. For each pick, parse the returned actual values and compute:
   - `hit = (direction === "OVER" && actual_value > line) || (direction === "UNDER" && actual_value < line)`
   - `difference = actual_value - line`
   - If a player's result is not found: `hit: null, actual_value: null, reasoning: "Game not found or player did not play"`
6. Tally `wins` and `losses` (exclude `hit: null` entries).
7. **Write `picks:results:${picksForDate}` first** (30-day TTL) — this is the idempotency key.
8. Then read `picks:record`, increment wins/losses, write back. If `picks:record` does not exist yet, initialize from this batch's totals.
9. Return `{ ok: true, wins, losses, total }`.

**Order of steps 7 and 8 is critical:** results key is written before record is updated so that if the function crashes between them, a retry will skip at step 3 and the record will not be double-incremented.

### api/results.js — new endpoint
- **Method:** GET /api/results
- **No auth required**

**Logic:**
1. Compute `yesterdayStr` as yesterday's date in PT (`YYYY-MM-DD`).
2. Read `picks:results:${yesterdayStr}` and `picks:record` from KV in parallel.
3. Return:
```json
{
  "results": { ...stored results object or null },
  "record": { "wins": 47, "losses": 23 },
  "date": "2026-03-25"
}
```
The `date` field in the response is sourced from `results.date` when results is non-null, falling back to `yesterdayStr` when null. This prevents a mismatch if the stored object's date differs from the computed yesterday.

Returns `{ results: null, record: { wins: 0, losses: 0 }, date: yesterdayStr }` gracefully if nothing graded yet.

### vercel.json — changes
Add grade cron and increase maxDuration:
```json
{
  "functions": { "api/*.js": { "maxDuration": 300 } },
  "crons": [
    { "path": "/api/cron", "schedule": "0 17 * * *" },
    { "path": "/api/cron", "schedule": "0 21 * * *" },
    { "path": "/api/cron", "schedule": "0 2 * * *" },
    { "path": "/api/grade", "schedule": "0 15 * * *" }
  ]
}
```

## Frontend Changes

### Stats strip
Add a **sixth** stat tile `W-L RECORD` showing `wins-losses` (e.g. `47-23`) from `picks:record`. The existing strip has five tiles (Total Picks, Overs, Unders, Avg Conf, Props Scanned). The new tile is appended after them.

`loadPicks()` is extended to also call `/api/results` in parallel with `/api/picks`, then populate the W-L tile and render the results section.

### Yesterday's Results section
Rendered below the picks grid. Only shown when `results` is non-null.

**Structure:**
- Section header: "Yesterday's Results" + date string + record badge (e.g. `11-3 yesterday`)
- One compact card per graded pick:
  - ✅ or ❌ icon (`hit: null` shows ➖)
  - Player name + stat
  - Line vs actual: e.g. `O 24.5 → 28.1` (green if hit, red if miss, grey if null)
  - One-line reasoning string
- Sort order: hits first, then misses, then nulls
- No filter controls — always fully expanded

## Out of Scope
- Autocorrection / confidence adjustment based on historical results
- Per-sport or per-stat win rate breakdowns
- UI for browsing results older than yesterday
