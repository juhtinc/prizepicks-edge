/**
 * lib/lore/weekly-batch.js  →  /api/lore?route=weekly-batch
 * Fan-out orchestrator designed for Vercel Hobby 60-second limit.
 *
 * Runs ONCE per week (Monday) to produce 7 videos total (1 per day).
 * Scale to 2/day after analytics confirm what works.
 *
 * Phases (each is a separate serverless invocation):
 *   ?phase=plan     — Pick 7 story topics (fast ~15s), then fan out 7 parallel script workers
 *   ?phase=script   — Generate 1 script for &index=N (~30-40s). Auto-triggers enhance when all 7 done.
 *   ?phase=enhance  — Fan out metadata + hook + music for each script in parallel
 *   ?phase=clips    — Source clips for the batch
 *
 * Default phase is "plan" (entry point).
 *
 * Query params:
 *   ?batch=A|B  — which half of the week (auto-detected from day if not set)
 *
 * Auth: x-secret header or Authorization: Bearer <CRON_SECRET>
 */

const axios = require("axios");
const { askClaudeJSON, askClaude } = require("./lib/claude");
const { newScriptRow, saveBatch, saveScript, getBatch, getBatchScripts, getRecentAnalytics } = require("./lib/kv-lore");
const { getBatchIdForDate } = require("./lib/utils");
const { getStoryTemplate, getProvocation } = require("./lib/story-templates");
const { getOptimalPostTime } = require("./lib/post-times");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  const authHeader = req.headers.authorization;
  const expected = process.env.CRON_SECRET;
  if (secret !== expected && authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const phase = req.query.phase || "plan";
  const now = new Date();
  const batchHalf = req.query.batch || req.body?.batch || (now.getDay() <= 2 ? "A" : "B");
  const baseBatchId = req.body?.batchId || getBatchIdForDate(now);
  const batchId = baseBatchId.includes("-") && !baseBatchId.endsWith(batchHalf)
    ? `${baseBatchId}-${batchHalf}`
    : baseBatchId;
  const baseUrl = `https://${req.headers.host}`;
  const headers = { "x-secret": expected, "Content-Type": "application/json" };

  // ── PHASE 1: Plan — pick 7 topics, fan out script workers ──
  if (phase === "plan") {
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

    // Check if the other batch already exists this week (to avoid duplicate players)
    const otherHalf = batchHalf === "A" ? "B" : "A";
    const otherBatchId = `${getBatchIdForDate(now)}-${otherHalf}`;
    const otherScripts = await getBatchScripts(otherBatchId);
    const alreadyUsedPlayers = otherScripts.map(s => s.playerName).filter(Boolean);
    const avoidList = alreadyUsedPlayers.length > 0
      ? `\nDO NOT use these players (already covered this week): ${alreadyUsedPlayers.join(", ")}`
      : "";

    const storyPrompt = `You are the content strategist for Sports Lore, a YouTube Shorts channel about forgotten and surprising sports history.

Select 7 unique story ideas. This is a single weekly batch (7 videos, 1 per day). Each story should be about a different NBA player/event. ALL stories must be NBA-focused.

FOCUS: Legacy/classic NBA players — pre-2000s and early 2000s era. Stories that make people say "wait, WHAT?" and "I had no idea." Avoid current active players. No GOAT comparison debates (no "X vs Y" matchups).

PRIORITIZE these proven high-viral formats for a NEW channel:
1. "Shocking stat nobody knows" — mind-blowing numbers that seem impossible (drives "how??" comments)
2. "The NBA banned/changed this because of one player" — rule changes caused by dominant players
3. "What if" injury tragedies — players whose careers were cut short (emotional = high completion)
4. "Forgotten dominant performances" — single-game or single-season feats that got buried by time
5. "Scandal/controversy with consequences" — stories where something went wrong and changed everything

These formats consistently get 70%+ completion rates on YouTube Shorts, which is critical for a new channel's algorithm placement.
${avoidList}

PERFORMANCE DATA FROM LAST 4 WEEKS:
${analyticsContext}

Story types available:
- forgotten_legend, what_if, record_breaker, scandal, underdog, comeback, draft_bust, rivalry

DO NOT use goat_debate. Lead with the most mind-blowing, scroll-stopping stories first. Every story must have a "holy shit" moment that would make someone share it.

Return JSON:
{"stories":[{"player_name":"...","player_sport":"NBA","story_type":"...","one_line_pitch":"..."},...]}`;

    const { stories } = await askClaudeJSON(storyPrompt, { maxTokens: 1000 });

    // Save the plan to KV so script workers can read their assignment
    const rowIds = [];
    for (let i = 0; i < stories.length; i++) {
      const story = stories[i];
      // 1 video per day: each story gets its own day
      const dayOffset = i + 1;
      const timeSlot = "evening"; // single daily post — evening for max NBA audience
      const scheduledDate = new Date(now);
      scheduledDate.setDate(scheduledDate.getDate() + dayOffset);

      const row = newScriptRow(batchId, i + 1, {
        scheduledDate: scheduledDate.toISOString().split("T")[0],
        playerName: story.player_name,
        playerSport: story.player_sport,
        storyType: story.story_type,
        oneLine: story.one_line_pitch,
        scheduledPostTime: getOptimalPostTime(story.player_sport, timeSlot),
        status: "Planned",
      });

      await saveScript(row.rowId, row);
      rowIds.push(row.rowId);
    }

    await saveBatch(batchId, {
      batchId, weekOf: now.toISOString().split("T")[0],
      rowIds, status: "Planning", createdAt: now.toISOString(), videoCount: stories.length,
      scriptsCompleted: 0,
    });

    // Fan out: fire 7 parallel script workers (fire-and-forget)
    for (let i = 0; i < stories.length; i++) {
      axios.post(
        `${baseUrl}/api/lore?route=weekly-batch&phase=script&index=${i + 1}&batch=${batchHalf}`,
        { batchId },
        { headers, timeout: 55000 }
      ).catch(e => console.error(`[plan] script worker ${i + 1} dispatch failed:`, e.message));
    }

    return res.status(200).json({
      ok: true, phase: "plan", batchId, rowIds,
      message: `Planned ${stories.length} stories, dispatched ${stories.length} parallel script workers`,
    });
  }

  // ── PHASE 2: Script — generate 1 script for index N ──
  if (phase === "script") {
    const index = parseInt(req.query.index || req.body?.index);
    if (!index) return res.status(400).json({ error: "Missing ?index= parameter" });

    const rowId = `${batchId}-${index}`;
    const row = await require("./lib/kv-lore").getScript(rowId);
    if (!row) return res.status(404).json({ error: `Script row ${rowId} not found` });

    // Research public opinion
    let publicOpinion = "";
    try {
      publicOpinion = await askClaude(
        `Search the web for public opinion about ${row.playerName} in ${row.playerSport}. ` +
        `Look at Reddit threads, Twitter/X discussions, and sports forums. ` +
        `What is the popular consensus? What are the hot takes? What do most fans believe? ` +
        `Summarize in 2-3 sentences the dominant public opinion and any popular controversial takes.`,
        { maxTokens: 300, system: "You are a sports research assistant. Be concise." }
      );
    } catch (e) { console.error(`[script ${index}] opinion research failed:`, e.message); }

    // Get story template for structure guidance
    const template = getStoryTemplate(row.storyType);
    const provocation = getProvocation(row.storyType);
    const segmentGuide = template.segments
      .map(s => `[${s.start}s-${s.end}s] ${s.name}: ${s.description}`)
      .join("\n");
    const hookGuide = template.retentionHooks
      .map(h => `At ~${h.time}s: ${h.prompt}`)
      .join("\n");

    const scriptPrompt = `Write a 55-second YouTube Shorts voiceover script about ${row.playerName} (${row.storyType}).
Pitch: ${row.oneLine || row.storyType}

PUBLIC OPINION (from Reddit, Twitter, forums):
${publicOpinion || "No research available — use your own sports knowledge."}

STRUCTURE (follow this timeline):
${segmentGuide}

RETENTION HOOKS (MANDATORY — prevents viewers from swiping):
${hookGuide}

RULES:
- ~140 words total (55 seconds at natural speaking pace)
- First sentence must be a scroll-stopping hook (shocking stat, bold claim, or provocative question)
- PROVOCATION LEVEL: ${provocation.level.toUpperCase()}
  ${provocation.toneGuide}
  NEVER cite where opinions come from. Never say "people on Reddit think" or "fans on Twitter say." Just state the opinion as YOUR OWN confident take, backed by the facts and stats you present.
${provocation.controversialLine ? '- Include ONE quotable line designed to make people screenshot and share — a bold statement about rankings, legacy, or decisions that people will either love or hate.' : ""}
- Conversational tone — talk like you're arguing with a friend at a bar, not reading Wikipedia
- Include 1-2 surprising facts most people don't know
- CLOSING QUESTION: ${provocation.closingStyle}
  The LAST sentence MUST be a direct question to the audience. Examples: "Was he the real GOAT? Drop your answer." / "Prove me wrong in the comments." / "Who got robbed worse?"
- Add a subtle foreshadowing line in the first 5 seconds that only makes sense after watching the full video (drives rewatches)

Return JSON: {"script":"...","word_count":140,"opinion_stance":"what stance you took and why","comment_bait":"the exact closing question"}`;

    const result = await askClaudeJSON(scriptPrompt, { maxTokens: 800 });

    // Update the row with the generated script
    row.script = result.script;
    row.commentBait = result.comment_bait || "";
    row.status = "Pending";
    await saveScript(row.rowId, row);

    // Check if all scripts in the batch are done by scanning KV
    // (avoids race condition with parallel counter increments)
    const batch = await getBatch(batchId);
    if (batch) {
      const allScripts = await getBatchScripts(batchId);
      const completedCount = allScripts.filter(s => s.script && s.script.length > 0).length;
      batch.scriptsCompleted = completedCount;
      await saveBatch(batchId, batch);

      // If all scripts are done, trigger the enhance phase
      if (completedCount >= batch.videoCount) {
        batch.status = "Pending";
        await saveBatch(batchId, batch);
        axios.post(
          `${baseUrl}/api/lore?route=weekly-batch&phase=enhance&batch=${batchHalf}`,
          { batchId },
          { headers, timeout: 55000 }
        ).catch(e => console.error(`[script ${index}] enhance dispatch failed:`, e.message));
      }
    }

    return res.status(200).json({
      ok: true, phase: "script", index, rowId: row.rowId,
      playerName: row.playerName, wordCount: result.word_count,
      batchProgress: `${(batch?.scriptsCompleted || 0) + 1}/${batch?.videoCount || "?"}`,
    });
  }

  // ── PHASE 3: Enhance — fan out per-script workers, or process one script ──
  if (phase === "enhance") {
    const enhanceIndex = parseInt(req.query.index || req.body?.index || "0");

    // If no index specified, this is the dispatcher — fan out 7 enhance workers
    if (!enhanceIndex) {
      const scripts = await getBatchScripts(batchId);
      if (!scripts.length) return res.status(404).json({ error: "No scripts in batch" });

      for (let i = 0; i < scripts.length; i++) {
        axios.post(
          `${baseUrl}/api/lore?route=weekly-batch&phase=enhance&index=${i + 1}&batch=${batchHalf}`,
          { batchId },
          { headers, timeout: 55000 }
        ).catch(e => console.error(`[enhance] worker ${i + 1} dispatch failed:`, e.message));
      }

      return res.status(200).json({
        ok: true, phase: "enhance", batchId,
        dispatched: scripts.length,
        message: `Dispatched ${scripts.length} parallel enhance workers`,
      });
    }

    // Per-script enhance worker: run metadata + hook + music sequentially (~20-30s total)
    const rowId = `${batchId}-${enhanceIndex}`;
    const script = await require("./lib/kv-lore").getScript(rowId);
    if (!script) return res.status(404).json({ error: `Script ${rowId} not found` });

    const results = {};
    try {
      const resp = await axios.post(`${baseUrl}/api/lore?route=generate-metadata`, { rowId }, { headers, timeout: 25000 });
      results.metadata = resp.data;
    } catch (e) { console.error(`[enhance ${enhanceIndex}] metadata failed:`, e.message); results.metadata = "failed"; }

    try {
      const resp = await axios.post(`${baseUrl}/api/lore?route=optimize-hook`, { rowId }, { headers, timeout: 25000 });
      results.hook = resp.data;
    } catch (e) { console.error(`[enhance ${enhanceIndex}] hook failed:`, e.message); results.hook = "failed"; }

    try {
      const resp = await axios.post(`${baseUrl}/api/lore?route=select-music`, { rowId }, { headers, timeout: 15000 });
      results.music = resp.data;
    } catch (e) { console.error(`[enhance ${enhanceIndex}] music failed:`, e.message); results.music = "failed"; }

    // Check if all scripts are now enhanced — if so, trigger clips
    const allScripts = await getBatchScripts(batchId);
    const enhancedCount = allScripts.filter(s => s.titleA && s.titleA.length > 0).length;
    if (enhancedCount >= allScripts.length) {
      axios.post(
        `${baseUrl}/api/lore?route=weekly-batch&phase=clips&batch=${batchHalf}`,
        { batchId },
        { headers, timeout: 55000 }
      ).catch(e => console.error(`[enhance ${enhanceIndex}] clips dispatch failed:`, e.message));
    }

    return res.status(200).json({
      ok: true, phase: "enhance", index: enhanceIndex, rowId, results,
      enhancedCount: `${enhancedCount}/${allScripts.length}`,
    });
  }

  // ── PHASE 4: Clip sourcing + review link ──
  if (phase === "clips") {
    try {
      await axios.post(`${baseUrl}/api/lore?route=clip-sourcer`, { batchId }, { headers, timeout: 55000 });
    } catch (e) { console.error(`[batch] clip sourcing failed:`, e.message); }

    const batch = await getBatch(batchId);
    if (batch) {
      batch.status = "Review";
      batch.reviewUrl = `${baseUrl}/api/lore?route=clip-review&batchId=${batchId}&token=${expected}&html=1`;
      await saveBatch(batchId, batch);
    }

    return res.status(200).json({
      ok: true, phase: "clips", batchId,
      status: "Review",
      reviewUrl: batch?.reviewUrl,
      message: "Clips sourced. Review if needed — auto-approves Monday 6AM.",
    });
  }

  // Legacy: redirect old "stories" phase to "plan"
  if (phase === "stories") {
    return res.redirect(307, `${baseUrl}/api/lore?route=weekly-batch&phase=plan&batch=${batchHalf}`);
  }

  return res.status(400).json({ error: `Unknown phase: ${phase}` });
};
