/**
 * api/lore/lib/kv-lore.js
 * KV storage helpers for Sports Lore pipeline data.
 * Uses the same Vercel KV as the main app via api/_kv.js
 *
 * Key Prefixes:
 *   lore:batch:{batchId}        — batch metadata (status, week, video count)
 *   lore:script:{rowId}         — individual script queue row
 *   lore:analytics:{weekOf}     — weekly analytics summary
 *   lore:reupload:{videoId}     — re-upload queue entry
 *   lore:music:used             — recently used music tracks
 *   lore:rejections:patterns    — aggregated clip rejection patterns
 *   lore:published:{videoId}    — published video log entry
 */

const kv = require("../../../api/_kv");

// --- Script Queue Row Schema ---
function newScriptRow(batchId, index, data = {}) {
  const rowId = `${batchId}-${index}`;
  return {
    rowId,
    batchId,
    scheduledDate: data.scheduledDate || null,
    playerName: data.playerName || "",
    playerSport: data.playerSport || "",
    storyType: data.storyType || "",
    script: data.script || "",
    hookLine: data.hookLine || "",
    hookPattern: data.hookPattern || "",
    titleA: data.titleA || "",
    titleB: data.titleB || "",
    titleUsed: data.titleUsed || "",
    description: data.description || "",
    hashtags: data.hashtags || [],
    searchTerms: data.searchTerms || "",
    clipBriefs: data.clipBriefs || [],
    status: data.status || "Pending",
    clipsSourced: data.clipsSourced || 0,
    clipsRejected: data.clipsRejected || 0,
    rejectionReasons: data.rejectionReasons || [],
    clipSourceStatus: data.clipSourceStatus || "Pending",
    dateSourced: data.dateSourced || null,
    playerPhotoUrl: data.playerPhotoUrl || "",
    thumbnailUrl: data.thumbnailUrl || "",
    scheduledPostTime: data.scheduledPostTime || "",
    musicMood: data.musicMood || "",
    musicTrack: data.musicTrack || "",
    musicSource: data.musicSource || "",
    youtubeUrl: data.youtubeUrl || "",
    youtubeVideoId: data.youtubeVideoId || "",
    tiktokUrl: data.tiktokUrl || "",
    instagramUrl: data.instagramUrl || "",
    viewsAt48h: data.viewsAt48h || null,
    retentionAt48h: data.retentionAt48h || null,
    commentBait: data.commentBait || "",
    voiceoverUrl: data.voiceoverUrl || "",
    statOverlays: data.statOverlays || [],
  };
}

// --- Batch helpers ---
async function getBatch(batchId) {
  return kv.get(`lore:batch:${batchId}`);
}

async function saveBatch(batchId, data) {
  return kv.set(`lore:batch:${batchId}`, data, 86400 * 30);
}

async function getScript(rowId) {
  return kv.get(`lore:script:${rowId}`);
}

async function saveScript(rowId, data) {
  return kv.set(`lore:script:${rowId}`, data, 86400 * 30);
}

async function getBatchScripts(batchId) {
  const batch = await getBatch(batchId);
  if (!batch || !batch.rowIds) return [];
  const scripts = await Promise.all(batch.rowIds.map(id => getScript(id)));
  return scripts.filter(Boolean);
}

// --- Analytics helpers ---
async function saveAnalytics(weekOf, data) {
  return kv.set(`lore:analytics:${weekOf}`, data, 86400 * 90);
}

async function getAnalytics(weekOf) {
  return kv.get(`lore:analytics:${weekOf}`);
}

async function getRecentAnalytics(weeks = 4) {
  const results = [];
  const now = new Date();
  for (let i = 0; i < weeks; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const weekOf = d.toISOString().split("T")[0];
    const data = await getAnalytics(weekOf);
    if (data) results.push(data);
  }
  return results;
}

// --- Rejection patterns ---
async function getRejectionPatterns() {
  return (await kv.get("lore:rejections:patterns")) || {};
}

async function addRejection(rowId, reasons) {
  const patterns = await getRejectionPatterns();
  reasons.forEach(r => { patterns[r] = (patterns[r] || 0) + 1; });
  await kv.set("lore:rejections:patterns", patterns, 86400 * 30);
  const script = await getScript(rowId);
  if (script) {
    script.clipsRejected = (script.clipsRejected || 0) + 1;
    script.rejectionReasons = [...new Set([...(script.rejectionReasons || []), ...reasons])];
    await saveScript(rowId, script);
  }
}

// --- Published log ---
async function savePublished(videoId, data) {
  return kv.set(`lore:published:${videoId}`, data, 86400 * 90);
}

async function getPublished(videoId) {
  return kv.get(`lore:published:${videoId}`);
}

// --- Re-upload queue ---
async function queueReupload(videoId, data) {
  return kv.set(`lore:reupload:${videoId}`, data, 86400 * 14);
}

async function getReupload(videoId) {
  return kv.get(`lore:reupload:${videoId}`);
}

// --- Music tracking ---
async function getRecentlyUsedTracks(count = 7) {
  return (await kv.get("lore:music:used")) || [];
}

async function trackMusicUsage(trackName) {
  const used = await getRecentlyUsedTracks();
  used.unshift(trackName);
  if (used.length > 20) used.length = 20;
  await kv.set("lore:music:used", used, 86400 * 30);
}

module.exports = {
  newScriptRow, getBatch, saveBatch, getScript, saveScript, getBatchScripts,
  saveAnalytics, getAnalytics, getRecentAnalytics,
  getRejectionPatterns, addRejection,
  savePublished, getPublished,
  queueReupload, getReupload,
  getRecentlyUsedTracks, trackMusicUsage,
};
