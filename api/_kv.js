/**
 * api/_kv.js
 * Thin wrapper around Vercel KV REST API for storing/retrieving picks.
 * Uses plain fetch — no extra SDK needed.
 *
 * Vercel KV is a free Redis-compatible key-value store.
 * Set up at: https://vercel.com/dashboard → Storage → KV → Create
 * Then link to your project. Vercel auto-injects KV_REST_API_URL + KV_REST_API_TOKEN.
 */

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

function kvHeaders() {
  return {
    Authorization: `Bearer ${KV_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: kvHeaders(),
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (json.result === null || json.result === undefined) return null;
  try { return JSON.parse(json.result); } catch { return json.result; }
}

async function kvSet(key, value, exSeconds = 86400 * 2) {
  if (!KV_URL || !KV_TOKEN) return false;
  // Pipeline expects an array of commands: [["SET", key, val, "EX", secs]]
  const body = JSON.stringify([["SET", key, JSON.stringify(value), "EX", exSeconds]]);
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: "POST",
    headers: kvHeaders(),
    body,
  });
  if (!res.ok) {
    console.error("[kv] pipeline set failed:", res.status, await res.text());
  }
  return res.ok;
}

// In-memory fallback for local dev (no KV configured)
const memStore = {};
async function memGet(key) { return memStore[key] ?? null; }
async function memSet(key, value) { memStore[key] = value; return true; }

async function get(key) {
  if (KV_URL && KV_TOKEN) return kvGet(key);
  return memGet(key);
}

async function set(key, value, exSeconds) {
  if (KV_URL && KV_TOKEN) return kvSet(key, value, exSeconds);
  return memSet(key, value);
}

module.exports = { get, set };
