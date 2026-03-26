/**
 * api/_analyzer.js
 * Sends scraped props to Claude with web search to find the best plays.
 * Prefixed with _ so Vercel does NOT expose it as a route.
 */

const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildPropSummary(projections, maxPerSport = 35) {
  const byLeague = {};
  for (const p of projections) {
    const key = p.sport || p.league || "Other";
    if (!byLeague[key]) byLeague[key] = [];
    if (byLeague[key].length < maxPerSport) byLeague[key].push(p);
  }
  let summary = "";
  for (const [league, props] of Object.entries(byLeague)) {
    summary += `\n=== ${league} ===\n`;
    for (const p of props) {
      summary += `${p.player} (${p.team || "?"}) | ${p.stat}: ${p.line}\n`;
    }
  }
  return summary;
}

async function analyzePicks(projections, leaguesSeen) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  const maxPicks = parseInt(process.env.MAX_PICKS || "16");
  const summary = buildPropSummary(projections, 35);

  console.log(`[analyzer] Sending ${projections.length} props to Claude...`);

  const prompt = `You are an elite sports betting analyst specializing in player props. Today is ${today}.

Below are LIVE PrizePicks prop lines scraped right now. Identify the ${maxPicks} BEST plays with the strongest edges.

AVAILABLE PROPS:
${summary}

LEAGUES ACTIVE: ${leaguesSeen.join(", ")}

Instructions:
1. Use the web_search tool to research recent news, injuries, lineup changes, and performance trends for any players you're considering.
2. For esports props (Valorant, LoL, CS2, Dota, Rocket League, etc.) — search for team form, recent match results, and meta context.
3. Find genuine edges — lines that look mispriced given current context.
4. Return ONLY a valid JSON array. No markdown, no backticks, no explanation outside the array.

Each element must have EXACTLY these fields:
{
  "player": "exact name from the list",
  "team": "team abbreviation",
  "sport": "sport/league name",
  "stat": "exact stat name from the list",
  "line": <number>,
  "direction": "OVER" or "UNDER",
  "confidence": <integer 60-95>,
  "reasoning": "3-5 sentences. Cite specific recent facts: news, stats, injuries, matchup info, trends you found via search.",
  "tags": ["tag1", "tag2", "tag3"]
}

Valid tags: "Hot Streak", "Injury Boost", "Favorable Matchup", "Back-to-Back", "Revenge Game", "Home Tilt", "Under Pace", "Weak Defense", "Weather Factor", "Trending Up", "Line Value", "Role Change", "Esports Edge", "Meta Pick", "Star Missing", "Underdog Value", "Pace Mismatch", "Rest Advantage", "Motivated Spot", "Public Fade"

Scoring: 85-95 = elite edge | 75-84 = solid play | 60-74 = value lean
Only include players from the AVAILABLE PROPS list. Return ONLY the JSON array.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: prompt }],
  });

  let rawText = "";
  for (const block of response.content || []) {
    if (block.type === "text") rawText += block.text;
  }

  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Claude did not return a valid JSON array");

  const picks = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(picks) || picks.length === 0) throw new Error("Empty picks array returned");

  console.log(`[analyzer] ${picks.length} picks returned`);
  return picks;
}

module.exports = { analyzePicks };
