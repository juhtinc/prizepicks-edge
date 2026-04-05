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
const {
  newScriptRow,
  saveBatch,
  saveScript,
  getBatch,
  getBatchScripts,
  getRecentAnalytics,
} = require("./lib/kv-lore");
const { getBatchIdForDate } = require("./lib/utils");
const { getStoryTemplate, getProvocation } = require("./lib/story-templates");
const { getOptimalPostTime } = require("./lib/post-times");

module.exports = async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "POST only" });

  const secret = req.headers["x-secret"] || req.query.secret;
  const authHeader = req.headers.authorization;
  const expected = process.env.CRON_SECRET;
  if (secret !== expected && authHeader !== `Bearer ${expected}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const phase = req.query.phase || "plan";
  const now = new Date();
  const batchHalf =
    req.query.batch || req.body?.batch || (now.getDay() <= 2 ? "A" : "B");
  const baseBatchId = req.body?.batchId || getBatchIdForDate(now);
  const batchId =
    baseBatchId.includes("-") && !baseBatchId.endsWith(batchHalf)
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
      recentAnalytics.forEach((week) => {
        if (week.byType) {
          Object.entries(week.byType).forEach(([type, data]) => {
            if (!byType[type])
              byType[type] = { views: 0, retention: 0, count: 0 };
            byType[type].views += data.avgViews || 0;
            byType[type].retention += parseFloat(data.avgRetention || 0);
            byType[type].count++;
          });
        }
      });
      analyticsContext = Object.entries(byType)
        .map(
          ([type, d]) =>
            `${type}: ${Math.round(d.views / d.count)} avg views, ${(d.retention / d.count).toFixed(1)}% retention`,
        )
        .sort()
        .join("\n");
    }

    // Check if the other batch already exists this week (to avoid duplicate players)
    const otherHalf = batchHalf === "A" ? "B" : "A";
    const otherBatchId = `${getBatchIdForDate(now)}-${otherHalf}`;
    const otherScripts = await getBatchScripts(otherBatchId);
    const alreadyUsedPlayers = otherScripts
      .map((s) => s.playerName)
      .filter(Boolean);
    const avoidList =
      alreadyUsedPlayers.length > 0
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

STORY TYPE PERFORMANCE (historical — use this to weight your choices):
${await (async () => {
  const types = [
    "forgotten_legend",
    "record_breaker",
    "what_if",
    "scandal",
    "comeback",
    "rivalry",
    "draft_bust",
    "underdog",
  ];
  const lines = [];
  for (const t of types) {
    const d = await kv.get(`lore:perf:${t}`);
    if (d) {
      const p = typeof d === "string" ? JSON.parse(d) : d;
      lines.push(
        `${t}: ${p.avgViews || 0} avg views, ${p.avgRetention || 0}% retention, ${p.failRate || 0}% fail rate (${p.count || 0} videos)`,
      );
    }
  }
  return lines.length > 0 ? lines.join("\n") : "No per-type data yet.";
})()}

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
      const scheduledDate = new Date(now);
      scheduledDate.setDate(scheduledDate.getDate() + dayOffset);
      const dayOfWeek = scheduledDate.getDay(); // 0=Sun, 6=Sat
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      // Weekdays: evening (6-7 PM) for post-work scrolling
      // Weekends: morning/midday (11 AM-12 PM) for relaxed browsing
      const timeSlot = isWeekend ? "morning" : "evening";

      const row = newScriptRow(batchId, i + 1, {
        scheduledDate: scheduledDate.toISOString().split("T")[0],
        playerName: story.player_name,
        playerSport: story.player_sport,
        storyType: story.story_type,
        oneLine: story.one_line_pitch,
        scheduledPostTime: isWeekend
          ? "12:00"
          : getOptimalPostTime(story.player_sport, timeSlot),
        status: "Planned",
      });

      await saveScript(row.rowId, row);
      rowIds.push(row.rowId);
    }

    await saveBatch(batchId, {
      batchId,
      weekOf: now.toISOString().split("T")[0],
      rowIds,
      status: "Planning",
      createdAt: now.toISOString(),
      videoCount: stories.length,
      scriptsCompleted: 0,
    });

    // Fan out: fire 7 parallel script workers (fire-and-forget)
    for (let i = 0; i < stories.length; i++) {
      axios
        .post(
          `${baseUrl}/api/lore?route=weekly-batch&phase=script&index=${i + 1}&batch=${batchHalf}`,
          { batchId },
          { headers, timeout: 55000 },
        )
        .catch((e) =>
          console.error(
            `[plan] script worker ${i + 1} dispatch failed:`,
            e.message,
          ),
        );
    }

    return res.status(200).json({
      ok: true,
      phase: "plan",
      batchId,
      rowIds,
      message: `Planned ${stories.length} stories, dispatched ${stories.length} parallel script workers`,
    });
  }

  // ── PHASE 2: Script — generate 1 script for index N ──
  if (phase === "script") {
    const index = parseInt(req.query.index || req.body?.index);
    if (!index)
      return res.status(400).json({ error: "Missing ?index= parameter" });

    const rowId = `${batchId}-${index}`;
    const row = await require("./lib/kv-lore").getScript(rowId);
    if (!row)
      return res.status(404).json({ error: `Script row ${rowId} not found` });

    // Research public opinion
    let publicOpinion = "";
    try {
      publicOpinion = await askClaude(
        `Search the web for public opinion about ${row.playerName} in ${row.playerSport}. ` +
          `Look at Reddit threads, Twitter/X discussions, and sports forums. ` +
          `What is the popular consensus? What are the hot takes? What do most fans believe? ` +
          `Summarize in 2-3 sentences the dominant public opinion and any popular controversial takes.`,
        {
          maxTokens: 300,
          system: "You are a sports research assistant. Be concise.",
        },
      );
    } catch (e) {
      console.error(`[script ${index}] opinion research failed:`, e.message);
    }

    // Get story template for structure guidance
    const template = getStoryTemplate(row.storyType);
    const provocation = getProvocation(row.storyType);
    const segmentGuide = template.segments
      .map((s) => `[${s.start}s-${s.end}s] ${s.name}: ${s.description}`)
      .join("\n");
    const hookGuide = template.retentionHooks
      .map((h) => `At ~${h.time}s: ${h.prompt}`)
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
- ABSOLUTE HARD LIMIT: 110 words MAXIMUM. This is critical — the voiceover MUST be under 59 seconds. ElevenLabs speaks at ~1.9 words/second with natural pauses, so 110 words ≈ 58 seconds. Count EVERY word. Aim for 100-110 words.
- First sentence must be a scroll-stopping hook with the player's ACTUAL STATS (e.g. "This man averaged 26 points and 16 rebounds per game — and nobody remembers his name.")
- THIS IS A HISTORICAL / EDUCATIONAL SPORTS CHANNEL for modern NBA fans:
  * Lead with their actual career stats and accomplishments
  * Describe what made them special in their era
  * Tell the story of their career — the highs, the context, the legacy
  * Use specific numbers, dates, and facts about THIS player
  * DO NOT reference other old/obscure NBA players by name (viewers won't know them)
  * You MAY reference widely known names (LeBron, Jordan, Shaq, Kobe, Curry) ONLY for brief context
  * DO NOT compare them to other players or rank them against peers
  * DO NOT say "better than [other player]" or "before [other player] there was..."
  * The story is about THEM — their stats, their moments, their impact
- PROVOCATION LEVEL: ${provocation.level.toUpperCase()}
  ${provocation.toneGuide}
  NEVER cite where opinions come from. Just state your take confidently, backed by the player's own facts and stats.
${provocation.controversialLine ? "- Include ONE quotable line designed to make people screenshot and share — a bold statement about this player's legacy or how they were overlooked." : ""}
- Conversational tone — talk like you're telling a friend an incredible story they've never heard
- Include 1-2 surprising facts most people don't know about THIS player
- CLOSING QUESTION: ${provocation.closingStyle}
  The LAST sentence MUST be a direct question to the audience. Examples: "Did you know about this guy? Drop your answer." / "Should he be more famous? Comment below." / "Who else got robbed by history?"
- LOOP STRUCTURE (MANDATORY — drives rewatches, every replay = another view):
  The closing question MUST circle back to or recontextualize the opening sentence.
  Example: If you open with "This man's name should be on every NBA Mount Rushmore"
  then close with "26 points. 16 rebounds. Every game. So whose Mount Rushmore is he on?"
  When the video auto-replays, the viewer hears the opening again with NEW context — they now know who it is, making them watch again.
  DO NOT make the loop feel forced. It should feel like a natural narrative circle.
- Add a subtle foreshadowing line in the first 5 seconds that only makes sense after watching the full video (drives rewatches)

Return JSON: {"script":"...","word_count":<actual count>,"opinion_stance":"what stance you took and why","comment_bait":"the exact closing question","loop_explanation":"how the closing question circles back to the opening","foreshadow_line":"the foreshadowing line and when it pays off"}`;

    const result = await askClaudeJSON(scriptPrompt, { maxTokens: 600 });

    // Enforce word count limit — trim to complete sentences under 105 words
    let scriptText = result.script || "";
    const words = scriptText.split(/\s+/).filter(Boolean);
    if (words.length > 115) {
      const sentences = scriptText.split(/(?<=[.!?])\s+/);
      let trimmed = "";
      let count = 0;
      for (const sentence of sentences) {
        const sentenceWords = sentence.split(/\s+/).filter(Boolean).length;
        if (count + sentenceWords > 112) break;
        trimmed += (trimmed ? " " : "") + sentence;
        count += sentenceWords;
      }
      scriptText =
        trimmed || scriptText.split(/\s+/).slice(0, 110).join(" ") + ".";
    }

    // Update the row with the generated script + quality metadata
    row.script = scriptText;
    row.commentBait = result.comment_bait || "";
    row.loopExplanation = result.loop_explanation || "";
    row.foreshadowLine = result.foreshadow_line || "";
    row.status = "Pending";
    await saveScript(row.rowId, row);

    // Check if all scripts in the batch are done by scanning KV
    // (avoids race condition with parallel counter increments)
    const batch = await getBatch(batchId);
    if (batch) {
      const allScripts = await getBatchScripts(batchId);
      const completedCount = allScripts.filter(
        (s) => s.script && s.script.length > 0,
      ).length;
      batch.scriptsCompleted = completedCount;
      await saveBatch(batchId, batch);

      // If all scripts are done, trigger the enhance phase
      if (completedCount >= batch.videoCount) {
        batch.status = "Pending";
        await saveBatch(batchId, batch);
        axios
          .post(
            `${baseUrl}/api/lore?route=weekly-batch&phase=enhance&batch=${batchHalf}`,
            { batchId },
            { headers, timeout: 55000 },
          )
          .catch((e) =>
            console.error(
              `[script ${index}] enhance dispatch failed:`,
              e.message,
            ),
          );
      }
    }

    return res.status(200).json({
      ok: true,
      phase: "script",
      index,
      rowId: row.rowId,
      playerName: row.playerName,
      wordCount: result.word_count,
      batchProgress: `${(batch?.scriptsCompleted || 0) + 1}/${batch?.videoCount || "?"}`,
    });
  }

  // ── PHASE 3: Enhance — fan out per-script workers, or process one script ──
  if (phase === "enhance") {
    const enhanceIndex = parseInt(req.query.index || req.body?.index || "0");

    // If no index specified, this is the dispatcher — fan out 7 enhance workers
    if (!enhanceIndex) {
      const scripts = await getBatchScripts(batchId);
      if (!scripts.length)
        return res.status(404).json({ error: "No scripts in batch" });

      for (let i = 0; i < scripts.length; i++) {
        axios
          .post(
            `${baseUrl}/api/lore?route=weekly-batch&phase=enhance&index=${i + 1}&batch=${batchHalf}`,
            { batchId },
            { headers, timeout: 55000 },
          )
          .catch((e) =>
            console.error(
              `[enhance] worker ${i + 1} dispatch failed:`,
              e.message,
            ),
          );
      }

      return res.status(200).json({
        ok: true,
        phase: "enhance",
        batchId,
        dispatched: scripts.length,
        message: `Dispatched ${scripts.length} parallel enhance workers`,
      });
    }

    // Per-script enhance worker: run metadata + hook + music sequentially (~20-30s total)
    const rowId = `${batchId}-${enhanceIndex}`;
    const script = await require("./lib/kv-lore").getScript(rowId);
    if (!script)
      return res.status(404).json({ error: `Script ${rowId} not found` });

    const results = {};
    try {
      const resp = await axios.post(
        `${baseUrl}/api/lore?route=generate-metadata`,
        { rowId },
        { headers, timeout: 25000 },
      );
      results.metadata = resp.data;
    } catch (e) {
      console.error(`[enhance ${enhanceIndex}] metadata failed:`, e.message);
      results.metadata = "failed";
    }

    try {
      const resp = await axios.post(
        `${baseUrl}/api/lore?route=optimize-hook`,
        { rowId },
        { headers, timeout: 25000 },
      );
      results.hook = resp.data;
    } catch (e) {
      console.error(`[enhance ${enhanceIndex}] hook failed:`, e.message);
      results.hook = "failed";
    }

    try {
      const resp = await axios.post(
        `${baseUrl}/api/lore?route=select-music`,
        { rowId },
        { headers, timeout: 15000 },
      );
      results.music = resp.data;
    } catch (e) {
      console.error(`[enhance ${enhanceIndex}] music failed:`, e.message);
      results.music = "failed";
    }

    // Check if all scripts are now enhanced — if so, trigger clips
    const allScripts = await getBatchScripts(batchId);
    const enhancedCount = allScripts.filter(
      (s) => s.titleA && s.titleA.length > 0,
    ).length;
    if (enhancedCount >= allScripts.length) {
      axios
        .post(
          `${baseUrl}/api/lore?route=weekly-batch&phase=clips&batch=${batchHalf}`,
          { batchId },
          { headers, timeout: 55000 },
        )
        .catch((e) =>
          console.error(
            `[enhance ${enhanceIndex}] clips dispatch failed:`,
            e.message,
          ),
        );
    }

    return res.status(200).json({
      ok: true,
      phase: "enhance",
      index: enhanceIndex,
      rowId,
      results,
      enhancedCount: `${enhancedCount}/${allScripts.length}`,
    });
  }

  // ── PHASE 4: Trigger GitHub Actions for real footage sourcing ──
  if (phase === "clips") {
    const batch = await getBatch(batchId);
    const rowIds = batch?.rowIds || [];

    // Trigger GitHub Actions workflow for real clip sourcing via VPS
    if (process.env.GITHUB_PAT && rowIds.length > 0) {
      try {
        await axios.post(
          "https://api.github.com/repos/juhtinc/prizepicks-edge/dispatches",
          {
            event_type: "source-clips",
            client_payload: { batchId, rowIds },
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.GITHUB_PAT}`,
              Accept: "application/vnd.github.v3+json",
            },
            timeout: 10000,
          },
        );
        console.log(
          `[batch] GitHub Actions triggered for ${rowIds.length} scripts`,
        );
      } catch (e) {
        console.error(`[batch] GitHub dispatch failed: ${e.message}`);
        // Fallback to direct clip-sourcer (Pexels only)
        try {
          await axios.post(
            `${baseUrl}/api/lore?route=clip-sourcer`,
            { batchId },
            { headers, timeout: 55000 },
          );
        } catch (e2) {
          console.error(`[batch] fallback clip sourcing failed:`, e2.message);
        }
      }
    } else {
      // No GitHub PAT — use direct clip-sourcer (Pexels fallback)
      try {
        await axios.post(
          `${baseUrl}/api/lore?route=clip-sourcer`,
          { batchId },
          { headers, timeout: 55000 },
        );
      } catch (e) {
        console.error(`[batch] clip sourcing failed:`, e.message);
      }
    }

    if (batch) {
      batch.status = "Sourcing Clips";
      batch.reviewUrl = `${baseUrl}/api/lore?route=clip-review&batchId=${batchId}&token=${expected}&html=1`;
      await saveBatch(batchId, batch);
    }

    return res.status(200).json({
      ok: true,
      phase: "clips",
      batchId,
      status: "Sourcing Clips",
      message: `GitHub Actions triggered for ${rowIds.length} scripts. Clips will be ready in ~5 min.`,
    });
  }

  // Legacy: redirect old "stories" phase to "plan"
  if (phase === "stories") {
    return res.redirect(
      307,
      `${baseUrl}/api/lore?route=weekly-batch&phase=plan&batch=${batchHalf}`,
    );
  }

  return res.status(400).json({ error: `Unknown phase: ${phase}` });
};
