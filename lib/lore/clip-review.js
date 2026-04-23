/**
 * api/lore/clip-review.js  →  GET/POST /api/lore/clip-review
 * Clip review interface — lets you preview auto-selected clips and swap any that
 * don't look right before video production runs.
 *
 * GET  ?batchId=...&token=...  — returns all clips for the batch as JSON
 * GET  ?batchId=...&token=...&html=1  — returns the review page
 * POST { rowId, slot, action, ... }  — update a specific clip
 *
 * Actions:
 *   "research"  — re-search with a custom query: { query: "new search terms" }
 *   "set_url"   — manually set a YouTube URL + timestamp: { youtubeUrl, startTime }
 *   "approve"   — mark clip as approved (no change needed)
 *   "approve_all" — approve all clips for a row
 */

const { getScript, saveScript, getBatchScripts, getBatch } = require("./lib/kv-lore");

module.exports = async function handler(req, res) {
  const token = req.query.token || req.headers["x-secret"] || req.query.secret;
  if (token !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  // ── GET: Return clip data or review page ──
  if (req.method === "GET") {
    const { batchId, rowId, html } = req.query;

    // Single script's clips
    if (rowId) {
      const script = await getScript(rowId);
      if (!script) return res.status(404).json({ error: "Script not found" });

      if (html === "1") return res.status(200).send(buildReviewPage([script], token));

      return res.status(200).json({
        ok: true,
        rowId,
        playerName: script.playerName,
        clips: script.clipBriefs || [],
        statOverlays: script.statOverlays || [],
      });
    }

    // Full batch clips
    if (batchId) {
      const scripts = await getBatchScripts(batchId);
      if (!scripts.length) return res.status(404).json({ error: "No scripts in batch" });

      if (html === "1") return res.status(200).send(buildReviewPage(scripts, token));

      return res.status(200).json({
        ok: true,
        batchId,
        videos: scripts.map(s => ({
          rowId: s.rowId,
          playerName: s.playerName,
          storyType: s.storyType,
          clipCount: (s.clipBriefs || []).length,
          sourcedCount: (s.clipBriefs || []).filter(c => c.clipUrl).length,
          clips: s.clipBriefs || [],
        })),
      });
    }

    return res.status(400).json({ error: "batchId or rowId required" });
  }

  // ── POST: Update a clip ──
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });

  const { rowId, slot, action, query, youtubeUrl, startTime } = req.body || {};
  if (!rowId) return res.status(400).json({ error: "rowId required" });

  const script = await getScript(rowId);
  if (!script) return res.status(404).json({ error: "Script not found" });

  const clips = script.clipBriefs || [];

  if (action === "approve_all") {
    clips.forEach(c => { c.approved = true; });
    await saveScript(rowId, script);
    return res.status(200).json({ ok: true, rowId, approved: clips.length });
  }

  if (!slot) return res.status(400).json({ error: "slot required" });

  const clip = clips.find(c => c.slot === slot);
  if (!clip) return res.status(404).json({ error: `Slot ${slot} not found` });

  switch (action) {
    case "research": {
      // Update the search query — clip-sourcer will re-fetch on next run
      if (!query) return res.status(400).json({ error: "query required for research" });
      clip.searchQuery = query;
      clip.clipUrl = null;  // Clear old URL so it gets re-sourced
      clip.source = "pending_research";
      clip.manualQuery = query;
      break;
    }

    case "set_url": {
      // Manually set a specific YouTube video + timestamp
      if (!youtubeUrl) return res.status(400).json({ error: "youtubeUrl required" });
      clip.manualYoutubeUrl = youtubeUrl;
      clip.manualStartTime = startTime || 0;
      clip.source = "manual";
      clip.approved = true;
      break;
    }

    case "approve": {
      clip.approved = true;
      break;
    }

    default:
      return res.status(400).json({ error: "action must be research, set_url, approve, or approve_all" });
  }

  script.clipBriefs = clips;
  await saveScript(rowId, script);

  return res.status(200).json({ ok: true, rowId, slot, action, clip });
};

/**
 * Build a mobile-friendly HTML review page for clips.
 */
function buildReviewPage(scripts, token) {
  const baseUrl = "";  // relative URLs work since we're on the same domain

  const videoCards = scripts.map(script => {
    const clips = script.clipBriefs || [];
    const clipCards = clips.map(clip => `
      <div class="clip-card ${clip.approved ? 'approved' : ''} ${clip.clipUrl ? '' : 'missing'}" data-row="${script.rowId}" data-slot="${clip.slot}">
        <div class="clip-header">
          <span class="slot-num">#${clip.slot}</span>
          <span class="clip-time">${clip.start}s - ${(clip.start + clip.duration).toFixed(1)}s</span>
          <span class="clip-type ${clip.clipType}">${clip.clipType || "gameplay"}</span>
          ${clip.approved ? '<span class="badge approved-badge">approved</span>' : ''}
          ${clip.source === "manual" ? '<span class="badge manual-badge">manual</span>' : ''}
        </div>
        <div class="clip-body">
          <p class="clip-visual">${clip.visual || clip.searchQuery || ""}</p>
          <p class="clip-script">"${clip.matchesScript || ""}"</p>
          <p class="clip-search">Search: <code>${clip.searchQuery || ""}</code></p>
          ${clip.clipUrl ? `<p class="clip-source">Source: ${clip.source}</p>` : '<p class="clip-missing">No clip found</p>'}
        </div>
        <div class="clip-actions">
          <button class="btn btn-approve" onclick="approveClip('${script.rowId}', ${clip.slot})">Approve</button>
          <button class="btn btn-research" onclick="showResearch(this)">Re-search</button>
          <button class="btn btn-manual" onclick="showManual(this)">Set URL</button>
        </div>
        <div class="research-form" style="display:none">
          <input type="text" placeholder="New search query..." value="${clip.searchQuery || ""}">
          <button class="btn btn-submit" onclick="submitResearch('${script.rowId}', ${clip.slot}, this)">Search</button>
        </div>
        <div class="manual-form" style="display:none">
          <input type="text" placeholder="YouTube URL" class="yt-url">
          <input type="number" placeholder="Start (seconds)" class="yt-start" value="0">
          <button class="btn btn-submit" onclick="submitManual('${script.rowId}', ${clip.slot}, this)">Set</button>
        </div>
      </div>
    `).join("");

    return `
      <div class="video-card">
        <div class="video-header">
          <h2>${script.playerName}</h2>
          <span class="story-type">${script.storyType}</span>
          <span class="clip-count">${clips.filter(c => c.clipUrl).length}/${clips.length} clips sourced</span>
          <button class="btn btn-approve-all" onclick="approveAll('${script.rowId}')">Approve All</button>
        </div>
        <div class="clips-grid">${clipCards}</div>
      </div>
    `;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ColdVault — Clip Review</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 12px; }
  h1 { font-size: 20px; text-align: center; padding: 12px 0; color: #fff; }
  .subtitle { text-align: center; color: #666; font-size: 13px; margin-bottom: 16px; }

  .video-card { background: #1a1a1a; border-radius: 12px; margin-bottom: 16px; overflow: hidden; }
  .video-header { padding: 12px 16px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border-bottom: 1px solid #333; }
  .video-header h2 { font-size: 16px; color: #fff; }
  .story-type { background: #FF4444; color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
  .clip-count { font-size: 12px; color: #888; margin-left: auto; }

  .clips-grid { padding: 8px; display: flex; flex-direction: column; gap: 8px; }

  .clip-card { background: #222; border-radius: 8px; padding: 10px 12px; border-left: 3px solid #444; }
  .clip-card.approved { border-left-color: #4CAF50; }
  .clip-card.missing { border-left-color: #FF9800; }

  .clip-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .slot-num { font-weight: 700; color: #fff; font-size: 13px; }
  .clip-time { font-size: 11px; color: #888; }
  .clip-type { font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 600; }
  .clip-type.gameplay { background: #1565C0; color: #fff; }
  .clip-type.photo { background: #6A1B9A; color: #fff; }
  .clip-type.graphic { background: #E65100; color: #fff; }

  .badge { font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 600; }
  .approved-badge { background: #2E7D32; color: #fff; }
  .manual-badge { background: #F57F17; color: #000; }

  .clip-body { margin-bottom: 8px; }
  .clip-visual { font-size: 13px; color: #ccc; margin-bottom: 3px; }
  .clip-script { font-size: 11px; color: #888; font-style: italic; margin-bottom: 3px; }
  .clip-search { font-size: 11px; color: #666; }
  .clip-search code { background: #333; padding: 1px 4px; border-radius: 3px; color: #FFD700; }
  .clip-source { font-size: 11px; color: #4CAF50; }
  .clip-missing { font-size: 11px; color: #FF9800; }

  .clip-actions { display: flex; gap: 6px; margin-bottom: 6px; }
  .btn { border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }
  .btn-approve { background: #2E7D32; color: #fff; }
  .btn-approve-all { background: #2E7D32; color: #fff; font-size: 11px; padding: 4px 10px; }
  .btn-research { background: #1565C0; color: #fff; }
  .btn-manual { background: #6A1B9A; color: #fff; }
  .btn-submit { background: #FF4444; color: #fff; }

  .research-form, .manual-form { margin-top: 6px; display: flex; gap: 6px; }
  .research-form input, .manual-form input { flex: 1; background: #333; border: 1px solid #555; color: #fff; padding: 6px 8px; border-radius: 6px; font-size: 12px; }

  .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #333; color: #fff; padding: 8px 16px; border-radius: 8px; font-size: 13px; display: none; z-index: 100; }
</style>
</head>
<body>

<h1>Clip Review</h1>
<p class="subtitle">Clips auto-approve if you don't change them. Tap to swap any clip.</p>

${videoCards}

<div class="toast" id="toast"></div>

<script>
const TOKEN = "${token}";

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
  setTimeout(() => t.style.display = "none", 2000);
}

async function apiPost(body) {
  const resp = await fetch("/api/lore/clip-review", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-secret": TOKEN },
    body: JSON.stringify(body),
  });
  return resp.json();
}

async function approveClip(rowId, slot) {
  await apiPost({ rowId, slot, action: "approve" });
  const card = document.querySelector('[data-row="'+rowId+'"][data-slot="'+slot+'"]');
  if (card) { card.classList.add("approved"); }
  toast("Clip #" + slot + " approved");
}

async function approveAll(rowId) {
  await apiPost({ rowId, action: "approve_all" });
  document.querySelectorAll('[data-row="'+rowId+'"]').forEach(c => c.classList.add("approved"));
  toast("All clips approved");
}

function showResearch(btn) {
  const form = btn.closest(".clip-card").querySelector(".research-form");
  form.style.display = form.style.display === "none" ? "flex" : "none";
}

function showManual(btn) {
  const form = btn.closest(".clip-card").querySelector(".manual-form");
  form.style.display = form.style.display === "none" ? "flex" : "none";
}

async function submitResearch(rowId, slot, btn) {
  const input = btn.closest(".research-form").querySelector("input");
  await apiPost({ rowId, slot, action: "research", query: input.value });
  toast("Re-searching: " + input.value);
}

async function submitManual(rowId, slot, btn) {
  const form = btn.closest(".manual-form");
  const url = form.querySelector(".yt-url").value;
  const start = parseInt(form.querySelector(".yt-start").value) || 0;
  await apiPost({ rowId, slot, action: "set_url", youtubeUrl: url, startTime: start });
  const card = btn.closest(".clip-card");
  card.classList.add("approved");
  toast("Manual clip set for #" + slot);
}
</script>
</body>
</html>`;
}
