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
          text: `This is a PrizePicks board screenshot. Each player card has this layout:
- Player photo at top
- Player FULL NAME in bold white text below the photo
- A small pencil/edit icon followed by the LINE NUMBER (this is the most important number — read it VERY carefully)
- Below that: a stat label like "Points", "Rebounds", "Assists", "3-Pt Made", "Pts+Rebs+Asts", etc.
- At bottom: "More" and "Less" buttons

CRITICAL: The line number is the number next to the pencil icon (e.g. 28.5, 6.5, 0.5).
Read each digit carefully — 2 vs 8, 1 vs 7, 5 vs 6, and decimal points matter.
Double-check: NBA points lines for starters are typically 15-35. Rebounds 3-12. Assists 2-12.

Extract EVERY player prop. Return ONLY a valid JSON array:
[{"player":"Full Name","stat":"Points","line":28.5,"direction":null,"boost":"goblin"},...]

Rules:
- player: exact full name as shown on the card
- stat: standardized (Points, Rebounds, Assists, 3-Pt Made, Pts+Rebs+Asts, Fantasy Score, Strikeouts, Hits Allowed, Goals, Saves, etc.)
- line: THE EXACT NUMBER shown next to the pencil icon. Read carefully. Do not guess.
- direction: null (PrizePicks doesn't show direction on the board)
- boost: "goblin" if green shield icon visible on card, "demon" if red/orange icon visible, null if neither
- Include ALL cards visible, even partially shown
- This may be a long scrolling page with many rows of 5 cards each
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

const STAT_ALIASES = {
  'pra': 'pts+reb+ast', 'pts+rebs+asts': 'pts+reb+ast', 'points+rebounds+assists': 'pts+reb+ast',
  'pts+rebs': 'pts+reb', 'rebs+asts': 'reb+ast', 'rebounds+assists': 'reb+ast',
  '3-pt made': '3-pointers made', 'threes': '3-pointers made', '3pm': '3-pointers made',
  'fg attempted': 'field goals attempted', 'fga': 'field goals attempted',
};

function normStat(s) {
  const l = (s || "").toLowerCase().trim();
  return STAT_ALIASES[l] || l;
}

function findOddsMatch(prop, oddsLines) {
  if (!oddsLines?.props?.length) return null;

  const playerLower = (prop.player || "").toLowerCase().trim();
  const statNorm = normStat(prop.stat);

  const match = oddsLines.props.find(p => {
    const nameLower = p.player?.toLowerCase() || "";
    const nameMatch = nameLower === playerLower
      || nameLower.includes(playerLower)
      || playerLower.includes(nameLower.split(" ").pop());
    if (!nameMatch) return false;
    const sl = normStat(p.stat);
    return sl === statNorm || sl.includes(statNorm) || statNorm.includes(sl);
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
