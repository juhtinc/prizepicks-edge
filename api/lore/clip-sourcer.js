/**
 * api/lore/clip-sourcer.js  →  POST /api/lore/clip-sourcer
 * Feature #5: Source clips for a script (or all scripts in a batch in parallel).
 *
 * KEY DESIGN: Clips are synced to script content. Each clip slot corresponds to
 * a specific segment of the voiceover, so the viewer SEES what's being TALKED ABOUT.
 *
 * Uses story-templates.js for variable pacing per story type, and asks Claude to
 * generate search terms matched to each script segment's content.
 *
 * Body: { rowId } or { batchId } (batch = parallel all 7)
 * Auth: x-secret header
 */

const axios = require("axios");
const { askClaudeJSON } = require("./lib/claude");
const { getScript, saveScript, getBatchScripts, getRejectionPatterns } = require("./lib/kv-lore");
const { calculateClipSlots, getStoryTemplate } = require("./lib/story-templates");

async function sourceClipsForScript(script, rejectionPatterns) {
  const patternWarning = Object.entries(rejectionPatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => `${reason} (${count}x)`)
    .join(", ");

  // Get pacing-based clip slots from the story template
  const clipSlots = calculateClipSlots(script.storyType);
  const template = getStoryTemplate(script.storyType);

  // Build a segment map for Claude showing what the script says at each time range
  const segmentGuide = template.segments.map(seg =>
    `[${seg.start}s-${seg.end}s] "${seg.name}" — ${seg.description} (${seg.pacing} pacing, ${seg.clipCategory} clips)`
  ).join("\n");

  const prompt = `You are a video clip researcher for a YouTube Shorts channel about sports history.

CRITICAL RULE: Every clip must VISUALLY MATCH what the voiceover is saying at that moment. When the narrator talks about "his rookie season," the clip should show rookie-era footage. When the narrator says "the crowd went silent," the clip should show a stunned crowd.

This 55-second Short is about ${script.playerName} (${script.playerSport}, story type: ${script.storyType}).

THE FULL SCRIPT:
${script.script}

THE VIDEO IS DIVIDED INTO THESE SEGMENTS:
${segmentGuide}

I need ${clipSlots.length} clips total. For each clip slot below, generate a Pexels search term that:
1. Matches what the voiceover is saying during that time window
2. Is specific enough to find relevant stock footage (e.g., "basketball player driving to basket close up" not just "basketball")
3. Prioritizes the sport: ${script.playerSport}

CLIP SLOTS:
${clipSlots.map((slot, i) => `Clip ${i + 1}: [${slot.start}s-${(slot.start + slot.duration).toFixed(1)}s] segment="${slot.segmentName}" — ${slot.segmentDescription}`).join("\n")}

${patternWarning ? `AVOID these common clip issues from past weeks: ${patternWarning}.` : ""}

Return JSON:
{"clips":[{"slot":1,"search_term":"...","visual_description":"what viewer should see","matches_script":"brief quote from script this matches"},...],"player_photo_search":"${script.playerName} ${script.playerSport} portrait"}`;

  const result = await askClaudeJSON(prompt, { maxTokens: 2000 });

  // Fetch clips from Pexels
  const pexelsKey = process.env.PEXELS_API_KEY;
  const clipBriefs = [];

  for (let i = 0; i < clipSlots.length; i++) {
    const slot = clipSlots[i];
    const clipData = result.clips.find(c => c.slot === i + 1) || result.clips[i];
    const searchTerm = clipData?.search_term || `${script.playerSport} ${slot.clipCategory}`;

    let pexelsUrl = null;
    if (pexelsKey) {
      try {
        const resp = await axios.get("https://api.pexels.com/videos/search", {
          headers: { Authorization: pexelsKey },
          params: {
            query: searchTerm,
            per_page: 3,
            size: "medium",
            orientation: "portrait",
          },
        });
        const video = resp.data?.videos?.[0];
        if (video) {
          const file = video.video_files.find(f => f.quality === "hd" && f.width <= 1080)
            || video.video_files.find(f => f.quality === "hd")
            || video.video_files[0];
          pexelsUrl = file?.link;
        }
      } catch (e) {
        console.error(`[clip-sourcer] Pexels error for slot ${i + 1}:`, e.message);
      }
    }

    clipBriefs.push({
      slot: i + 1,
      start: slot.start,
      duration: slot.duration,
      segmentName: slot.segmentName,
      searchTerm,
      visualDescription: clipData?.visual_description || "",
      matchesScript: clipData?.matches_script || "",
      category: slot.clipCategory,
      pexelsUrl,
    });
  }

  return { clipBriefs, playerPhotoSearch: result.player_photo_search || "" };
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
        return { rowId: script.rowId, clipsSourced: script.clipsSourced, totalSlots: clipBriefs.length };
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
