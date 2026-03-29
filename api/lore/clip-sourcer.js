/**
 * api/lore/clip-sourcer.js  →  POST /api/lore/clip-sourcer
 * Feature #5: Source clips for a script (or all scripts in a batch in parallel).
 * Uses Pexels API for stock footage, with rejection pattern awareness (Feature #3).
 *
 * Body: { rowId } or { batchId } (batch = parallel all 7)
 * Auth: x-secret header
 */

const axios = require("axios");
const { askClaudeJSON } = require("./lib/claude");
const { getScript, saveScript, getBatchScripts, getRejectionPatterns } = require("./lib/kv-lore");

async function sourceClipsForScript(script, rejectionPatterns) {
  const patternWarning = Object.entries(rejectionPatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => `${reason} (${count}x)`)
    .join(", ");

  const prompt = `You are a video clip researcher for a YouTube Shorts channel about sports history.

Find 4 clip search terms for a 55-second Short about ${script.playerName} (${script.storyType}).

The script:
${script.script}

Each clip should be 5-15 seconds and clearly relate to the story. Generate search terms that would find:
1. A highlight/action clip of the player
2. A contextual clip (the era, team, stadium)
3. A dramatic moment clip (reaction, celebration, crowd)
4. A stats/graphic-style B-roll

${patternWarning ? `AVOID these common clip issues from past weeks: ${patternWarning}. Prioritize clips that clearly show the player's face and jersey number.` : ""}

Return JSON:
{"clips":[{"search_term":"...","description":"...","duration_target":10,"priority":"high|medium"},...],"player_photo_search":"..."}`;

  const result = await askClaudeJSON(prompt, { maxTokens: 500 });

  const pexelsKey = process.env.PEXELS_API_KEY;
  const clipBriefs = [];

  for (const clip of result.clips) {
    let pexelsUrl = null;
    if (pexelsKey) {
      try {
        const resp = await axios.get("https://api.pexels.com/videos/search", {
          headers: { Authorization: pexelsKey },
          params: { query: clip.search_term, per_page: 3, size: "medium" },
        });
        const video = resp.data?.videos?.[0];
        if (video) {
          const file = video.video_files.find(f => f.quality === "hd") || video.video_files[0];
          pexelsUrl = file?.link;
        }
      } catch (e) {
        console.error("[clip-sourcer] Pexels error:", e.message);
      }
    }

    clipBriefs.push({
      searchTerm: clip.search_term,
      description: clip.description,
      durationTarget: clip.duration_target,
      priority: clip.priority,
      pexelsUrl,
    });
  }

  return { clipBriefs, playerPhotoSearch: result.player_photo_search };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { rowId, batchId } = req.body || {};
  const rejectionPatterns = await getRejectionPatterns();

  if (batchId) {
    const scripts = await getBatchScripts(batchId);
    if (!scripts.length) return res.status(404).json({ error: "No scripts in batch" });

    const results = await Promise.all(
      scripts.map(async (script) => {
        const { clipBriefs, playerPhotoSearch } = await sourceClipsForScript(script, rejectionPatterns);
        script.clipBriefs = clipBriefs;
        script.clipsSourced = clipBriefs.filter(c => c.pexelsUrl).length;
        script.clipSourceStatus = script.clipsSourced > 0 ? "Auto-sourced" : "Manual";
        script.dateSourced = new Date().toISOString();
        script.playerPhotoUrl = playerPhotoSearch;
        await saveScript(script.rowId, script);
        return { rowId: script.rowId, clipsSourced: script.clipsSourced };
      })
    );

    return res.status(200).json({ ok: true, batchId, results });
  }

  if (!rowId) return res.status(400).json({ error: "rowId or batchId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  const { clipBriefs, playerPhotoSearch } = await sourceClipsForScript(script, rejectionPatterns);
  script.clipBriefs = clipBriefs;
  script.clipsSourced = clipBriefs.filter(c => c.pexelsUrl).length;
  script.clipSourceStatus = script.clipsSourced > 0 ? "Auto-sourced" : "Manual";
  script.dateSourced = new Date().toISOString();
  script.playerPhotoUrl = playerPhotoSearch;
  await saveScript(rowId, script);

  return res.status(200).json({ ok: true, rowId, clipBriefs });
};
