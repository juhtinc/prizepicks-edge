# Results Tracking & Grading System — Design Spec
Date: 2026-03-26

## Overview
Add a daily results grading system that automatically grades yesterday's PrizePicks picks against actual box scores, displays hits/misses in the UI, and tracks a running win-loss record over time. Autocorrection (adjusting future confidence based on past performance) is explicitly out of scope for this version.

## Data Model

| KV Key | Contents | Written by | TTL |
|---|---|---|---|
| `picks:latest` | Current picks batch (unchanged) | refresh.js | 48h |
| `picks:previous` | Copy of picks:latest before overwrite | refresh.js | 48h |
| `picks:results:YYYY-MM-DD` | Graded results for that date | grade.js | 30 days |
| `picks:record` | `{ wins, losses, lastUpdated }` | grade.js | no expiry |

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

### picks:record shape
```json
{ "wins": 47, "losses": 23, "lastUpdated": "2026-03-26T15:00:00Z" }
```

## API Changes

### api/refresh.js — archive step
Before saving new picks to `picks:latest`, copy the current `picks:latest` value to `picks:previous`. This is the only change to refresh.js.

```
const prev = await kv.get("picks:latest");
if (prev) await kv.set("picks:previous", prev, 86400 * 2);
// ... then save new picks to picks:latest as normal
```

### api/grade.js — new endpoint
- **Method:** POST (called by Vercel cron)
- **Auth:** CRON_SECRET via Authorization header (same pattern as cron.js)
- **Schedule:** 8am PT daily = `0 15 * * *` UTC in vercel.json
- **Idempotent:** Skip if `picks:results:TODAY` already exists

**Logic:**
1. Read `picks:previous` from KV. Exit early if empty.
2. Check if `picks:results:YESTERDAY` already exists — if so, return early (already graded).
3. Build a list of unique players and their sports/stats from the picks batch.
4. Call Claude with web_search tool: search for each player's actual stat line from yesterday's games (e.g. `"LeBron James points March 25 2026 box score"`).
5. For each pick, compare `actual_value` to `line`:
   - `hit = (direction === "OVER" && actual_value > line) || (direction === "UNDER" && actual_value < line)`
   - `difference = actual_value - line` (positive = over the line, negative = under)
6. Tally `wins` and `losses` for the batch.
7. Update `picks:record` by incrementing running totals.
8. Store graded results as `picks:results:YYYY-MM-DD` (using yesterday's date) with 30-day TTL.
9. Return `{ ok: true, wins, losses, total }`.

**Error handling:** If a player's stat can't be found (game postponed, player didn't play), set `hit: null`, `actual_value: null`, `reasoning: "Game not found or player did not play"`. These are excluded from win/loss tallying.

### api/results.js — new endpoint
- **Method:** GET /api/results
- **No auth required**
- Reads `picks:results:YESTERDAY` from KV
- Reads `picks:record` from KV
- Returns:
```json
{
  "results": { ...picks:results object or null },
  "record": { "wins": 47, "losses": 23 },
  "date": "2026-03-25"
}
```
- Returns `{ results: null, record: { wins: 0, losses: 0 }, date: "..." }` gracefully if nothing graded yet.

### vercel.json — new cron entry
```json
{ "path": "/api/grade", "schedule": "0 15 * * *" }
```

## Frontend Changes

### Stats strip
Add a fifth tile `W-L RECORD` showing `wins-losses` (e.g. `47-23`) from `picks:record`. The existing `loadPicks()` function is extended to also call `/api/results` and populate this tile.

### Yesterday's Results section
Rendered below the picks grid. Only shown when `results` is non-null.

**Structure:**
- Section header: "Yesterday's Results" + date string + record badge (e.g. `11-3 yesterday`)
- One compact card per graded pick:
  - ✅ or ❌ icon (null results shown as ➖)
  - Player name + stat
  - `O 24.5 → 28.1` (green if hit, red if miss)
  - One-line reasoning string
- Sort order: hits first, then misses, then nulls
- No filter controls — always fully expanded

### Implementation note
`loadPicks()` fetches both `/api/picks` and `/api/results` in parallel. Results section is built from the `/api/results` response.

## Out of Scope
- Autocorrection / confidence adjustment based on historical results
- Per-sport or per-stat win rate breakdowns
- UI for browsing results older than yesterday
