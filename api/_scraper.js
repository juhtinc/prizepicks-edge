/**
 * api/_scraper.js
 * Uses Claude AI with web search to find today's PrizePicks props
 * instead of hitting their API directly (which Cloudflare blocks).
 */

const Anthropic = require("@anthropic-ai/sdk");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function scrapeAll() {
  console.log("[scraper] Using AI web search to find today's PrizePicks props...");

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{
      role: "user",
      content: `Today is ${today}. Search for today's PrizePicks player prop lines that are currently available. Look for props across NBA, MLB, NHL, NFL, golf, and esports (Valorant, League of Legends, CS2, etc.).

Search for "PrizePicks props today ${today}" and related queries to find current lines.

Return ONLY a valid JSON array of props. No markdown, no backticks. Each object must have:
{
  "player": "Player Name",
  "team": "TEAM",
  "sport": "NBA",
  "stat": "Points",
  "line": 24.5
}

Return as many real props as you can find, minimum 20. Only include props you actually found via search with real line values.`
    }]
  });

  let rawText = "";
  for (const block of response.content || []) {
    if (block.type === "text") rawText += block.text;
  }

  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Could not find props via web search");

  const projections = JSON.parse(jsonMatch[0]).filter(p => p.line > 0);

  const grouped = {};
  for (const p of projections) {
    const key = p.sport || "Other";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(p);
  }

  const leaguesSeen = Object.keys(grouped);
  console.log(`[scraper] Found ${projections.length} props via web search across: ${leaguesSeen.join(", ")}`);

  return {
    projections,
    grouped,
    leaguesSeen,
    total: projections.length,
    scrapedAt: new Date().toISOString()
  };
}

module.exports = { scrapeAll };