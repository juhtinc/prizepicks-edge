/**
 * api/lore/weekly-batch.js  →  POST /api/lore/weekly-batch
 * Phased orchestrator to avoid Vercel's 60-second timeout.
 *
 * Phases (each is a separate invocation):
 *   ?phase=stories   — Select 7 stories + generate scripts (default)
 *   ?phase=enhance   — Generate metadata, hooks, music for all scripts
 *   ?phase=clips     — Source clips in parallel
 *
 * Auth: x-secret header or cron bearer token
 */

const axios = require("axios");
const { askClaudeJSON } = require("./lib/claude");
const { newScriptRow, saveBatch, saveScript, getBatch, getBatchScripts, getRecentAnalytics } = require("./lib/kv-lore");
const { getBatchIdForDate } = require("./lib/utils");
const { getStoryTemplate } = require("./lib/story-templates");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  const authHeader = req.headers.authorization;
  const expected = process.env.CRON_SECRET;
  if (secret !== expected && authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const phase = req.query.phase || "stories";
  const now = new Date();
  const batchId = req.body?.batchId || getBatchIdForDate(now);
  const baseUrl = `https://${req.headers.host}`;
  const headers = { "x-secret": expected, "Content-Type": "application/json" };

  // ── PHASE 1: Story selection + script generation ──
  if (phase === "stories") {
    const recentAnalytics = await getRecentAnalytics(4);
    let analyticsContext = "No analytics data yet — this is a new channel.";
    if (recentAnalytics.length > 0) {
      const byType = {};
      recentAnalytics.forEach(week => {
        if (week.byType) {
          Object.entries(week.byType).forEach(([type, data]) => {
            if (!byType[type]) byType[type] = { views: 0, retention: 0, count: 0 };
            byType[type].views += data.avgViews || 0;
            byType[type].retention += parseFloat(data.avgRetention || 0);
            byType[type].count++;
          });
        }
      });
      analyticsContext = Object.entries(byType)
        .map(([type, d]) => `${type}: ${Math.round(d.views / d.count)} avg views, ${(d.retention / d.count).toFixed(1)}% retention`)
        .sort().join("\n");
    }

    const storyPrompt = `You are the content strategist for Sports Lore, a YouTube Shorts channel about forgotten and surprising sports history.

Select 7 unique story ideas for this week. Each story should be about a different player/event from a different sport if possible.

PERFORMANCE DATA FROM LAST 4 WEEKS:
${analyticsContext}

Story types available:
- forgotten_legend, trending_callback, what_if, rivalry, record_breaker, comeback, scandal, draft_bust, underdog, goat_debate

Weight toward higher-performing story types but include at least 1 experimental type.

Return JSON:
{"stories":[{"player_name":"...","player_sport":"NBA|MLB|NFL|NHL|Soccer|Boxing|Tennis","story_type":"...","one_line_pitch":"..."},...]}`;

    const { stories } = await askClaudeJSON(storyPrompt, { maxTokens: 1000 });

    const rowIds = [];
    for (let i = 0; i < stories.length; i++) {
      const story = stories[i];
      const scheduledDate = new Date(now);
      scheduledDate.setDate(scheduledDate.getDate() + (i + 1));

      // Get story template for structure guidance
      const template = getStoryTemplate(story.story_type);
      const segmentGuide = template.segments
        .map(s => `[${s.start}s-${s.end}s] ${s.name}: ${s.description}`)
        .join("\n");
      const hookGuide = template.retentionHooks
        .map(h => `At ~${h.time}s: ${h.prompt}`)
        .join("\n");

      const scriptPrompt = `Write a 55-second YouTube Shorts voiceover script about ${story.player_name} (${story.story_type}).
Pitch: ${story.one_line_pitch}

STRUCTURE (follow this timeline):
${segmentGuide}

RETENTION HOOKS (you MUST include these to prevent viewers from swiping away):
${hookGuide}

RULES:
- ~140 words total (55 seconds at natural speaking pace)
- First sentence must be a scroll-stopping hook (shocking stat, bold claim, or provocative question)
- Conversational tone — talk like you're telling a friend, not reading Wikipedia
- Include 1-2 surprising facts most people don't know
- End with a question or CTA to drive comments ("Who do you think was better?")
- Every sentence should make the viewer NEED to hear the next one

Return JSON: {"script":"...","word_count":140}`;

      const result = await askClaudeJSON(scriptPrompt, { maxTokens: 800 });

      const row = newScriptRow(batchId, i + 1, {
        scheduledDate: scheduledDate.toISOString().split("T")[0],
        playerName: story.player_name,
        playerSport: story.player_sport,
        storyType: story.story_type,
        script: result.script,
        status: "Pending",
      });

      await saveScript(row.rowId, row);
      rowIds.push(row.rowId);
    }

    await saveBatch(batchId, {
      batchId, weekOf: now.toISOString().split("T")[0],
      rowIds, status: "Pending", createdAt: now.toISOString(), videoCount: stories.length,
    });

    axios.post(`${baseUrl}/api/lore/weekly-batch?phase=enhance`, { batchId }, { headers }).catch(() => {});

    return res.status(200).json({ ok: true, phase: "stories", batchId, rowIds });
  }

  // ── PHASE 2: Enhance scripts (metadata + hooks + music) ──
  if (phase === "enhance") {
    const scripts = await getBatchScripts(batchId);
    if (!scripts.length) return res.status(404).json({ error: "No scripts in batch" });

    for (const script of scripts) {
      try {
        await axios.post(`${baseUrl}/api/lore/generate-metadata`, { rowId: script.rowId }, { headers, timeout: 15000 });
      } catch (e) { console.error(`[batch] metadata failed ${script.rowId}:`, e.message); }

      try {
        await axios.post(`${baseUrl}/api/lore/optimize-hook`, { rowId: script.rowId }, { headers, timeout: 15000 });
      } catch (e) { console.error(`[batch] hook failed ${script.rowId}:`, e.message); }

      try {
        await axios.post(`${baseUrl}/api/lore/select-music`, { rowId: script.rowId }, { headers, timeout: 10000 });
      } catch (e) { console.error(`[batch] music failed ${script.rowId}:`, e.message); }
    }

    axios.post(`${baseUrl}/api/lore/weekly-batch?phase=clips`, { batchId }, { headers }).catch(() => {});

    return res.status(200).json({ ok: true, phase: "enhance", batchId, processed: scripts.length });
  }

  // ── PHASE 3: Clip sourcing + review link ──
  if (phase === "clips") {
    try {
      await axios.post(`${baseUrl}/api/lore/clip-sourcer`, { batchId }, { headers, timeout: 50000 });
    } catch (e) { console.error(`[batch] clip sourcing failed:`, e.message); }

    // Set status to "Review" — clips auto-approve if untouched by Monday 6AM
    const batch = await getBatch(batchId);
    if (batch) {
      batch.status = "Review";
      batch.reviewUrl = `${baseUrl}/api/lore/clip-review?batchId=${batchId}&token=${expected}&html=1`;
      await saveBatch(batchId, batch);
    }

    return res.status(200).json({
      ok: true,
      phase: "clips",
      batchId,
      status: "Review",
      reviewUrl: batch?.reviewUrl,
      message: "Clips sourced. Review if needed — auto-approves Monday 6AM.",
    });
  }

  return res.status(400).json({ error: `Unknown phase: ${phase}` });
};
