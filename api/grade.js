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
