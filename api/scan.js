/**
 * api/scan.js  →  POST /api/scan
 * Accepts base64-encoded screenshots of PrizePicks boards.
 * Uses Claude Vision to extract player props, then compares
 * against Odds API lines cached in KV.
 * Requires CRON_SECRET auth (uses Anthropic API).
 */

const Anthropic = require("@anthropic-ai/sdk");
const kv = require("./_kv");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "x-secret, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Auth
  const secret = req.headers["x-secret"] || req.body?.secret;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { images } = req.body || {};
  if (!images || !Array.isArray(images) || !images.length) {
    return res.status(400).json({ error: "images array required (base64 strings)" });
  }
  if (images.length > 10) {
    return res.status(400).json({ error: "Max 10 images per scan" });
  }

  try {
    // Process all images in parallel
    const results = await Promise.all(
      images.map((img, i) => extractProps(img, i))
    );

    // Flatten and deduplicate
    const allProps = [];
    const seen = new Set();
    for (const r of results) {
      for (const prop of r.props) {
        const key = `${prop.player?.toLowerCase()}|${prop.stat?.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          allProps.push(prop);
        }
      }
    }

    // Compare against Odds API lines
    let oddsLines = null;
    try {
      oddsLines = await kv.get("lines:combined");
    } catch (_) {}

    const compared = allProps.map(prop => {
      const match = findOddsMatch(prop, oddsLines);
      return { ...prop, odds: match };
    });

    // Sort by edge size (biggest first)
    compared.sort((a, b) => Math.abs(b.odds?.edge || 0) - Math.abs(a.odds?.edge || 0));

    const totalTokens = results.reduce((s, r) => s + (r.tokens || 0), 0);

    return res.status(200).json({
      props: compared,
      imageResults: results.map((r, i) => ({
        image: i + 1,
        propsFound: r.props.length,
        tokens: r.tokens,
      })),
      totalProps: compared.length,
      totalTokens,
      estimatedCost: (totalTokens / 1000000 * 3).toFixed(4), // ~$3/MTok for Sonnet
      hasOddsData: !!oddsLines?.props?.length,
    });
  } catch (err) {
    console.error("[scan] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};

async function extractProps(base64Img, index) {
  // Strip data URL prefix if present
  const raw = base64Img.replace(/^data:image\/\w+;base64,/, "");
  const mediaType = base64Img.startsWith("data:image/png") ? "image/png"
    : base64Img.startsWith("data:image/webp") ? "image/webp"
    : "image/jpeg";

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 8000,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: mediaType, data: raw },
        },
        {
          type: "text",
          text: `This is a PrizePicks board screenshot. Each player card shows:
- Player name (bold text)
- A stat category (Points, Rebounds, Assists, Pts+Rebs+Asts, Fantasy Score, Strikeouts, Hits, Goals, etc.)
- A line number (e.g. 24.5)
- Sometimes "More" or "Less" direction indicators
- Green shield icon means "Goblin" (hot streak)
- Red/orange icon means "Demon" (cold streak)

Extract EVERY player prop visible. Return ONLY a valid JSON array:
[{"player":"Full Name","stat":"Points","line":24.5,"direction":null},...]

Rules:
- player: exact full name as shown on the card
- stat: the stat type shown (Points, Rebounds, Assists, 3-Pt Made, Pts+Rebs+Asts, Fantasy Score, Strikeouts, Hits Allowed, Goals, Saves, etc.)
- line: the number shown (e.g. 24.5, 6.5, 0.5)
- direction: "OVER" or "UNDER" if indicated, otherwise null
- Include ALL cards visible, even if partially shown
- This may be a long scrolling page — extract every single card
JSON array only. No other text.`,
        },
      ],
    }],
  });

  let text = "";
  for (const b of response.content || []) {
    if (b.type === "text") text += b.text;
  }

  let props = [];
  console.log(`[scan] Image ${index + 1} raw response (first 500):`, text.slice(0, 500));
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      props = JSON.parse(match[0]);
      console.log(`[scan] Image ${index + 1}: parsed ${props.length} props`);
    } catch (e) {
      console.error(`[scan] Image ${index + 1} parse error:`, e.message);
      console.error(`[scan] Attempted to parse:`, match[0].slice(0, 300));
    }
  } else {
    console.error(`[scan] Image ${index + 1}: no JSON array found in response`);
    console.error(`[scan] Full response:`, text.slice(0, 1000));
  }

  // Tag each prop with source image
  props = (Array.isArray(props) ? props : []).map(p => ({
    ...p,
    sourceImage: index + 1,
  }));

  const tokens = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
  return { props, tokens };
}

function findOddsMatch(prop, oddsLines) {
  if (!oddsLines?.props?.length) return null;

  const playerLower = (prop.player || "").toLowerCase().trim();
  const statLower = (prop.stat || "").toLowerCase().trim();

  // Try exact, then partial match
  const match = oddsLines.props.find(p => {
    const nameLower = p.player?.toLowerCase() || "";
    const nameMatch = nameLower === playerLower
      || nameLower.includes(playerLower)
      || playerLower.includes(nameLower.split(" ").pop());
    if (!nameMatch) return false;
    const sl = p.stat?.toLowerCase() || "";
    return sl.includes(statLower) || statLower.includes(sl);
  });

  if (!match) return null;

  // Calculate edge: difference between PrizePicks line and consensus
  const bookLines = Object.values(match.books || {});
  const consensus = bookLines.length
    ? bookLines.reduce((a, b) => a + b, 0) / bookLines.length
    : null;

  return {
    books: match.books,
    bestOver: match.bestOver,
    bestUnder: match.bestUnder,
    consensus: consensus ? parseFloat(consensus.toFixed(1)) : null,
    edge: consensus != null && prop.line != null
      ? parseFloat((prop.line - consensus).toFixed(1))
      : null,
    discrepancy: match.discrepancy,
  };
}
