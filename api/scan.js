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
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: mediaType, data: raw },
        },
        {
          type: "text",
          text: `Extract every player prop from this screenshot. Return ONLY a JSON array:
[{"player":"Full Name","stat":"Points","line":24.5,"direction":"OVER"},...]
- player: full name exactly as shown
- stat: standardized (Points, Rebounds, Assists, Hits, Strikeouts, Goals, etc.)
- line: the number shown
- direction: OVER or UNDER if shown, or null
Include every prop visible. JSON array only, no other text.`,
        },
      ],
    }],
  });

  let text = "";
  for (const b of response.content || []) {
    if (b.type === "text") text += b.text;
  }

  let props = [];
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      props = JSON.parse(match[0]);
    } catch (e) {
      console.error(`[scan] Image ${index + 1} parse error:`, e.message);
    }
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
