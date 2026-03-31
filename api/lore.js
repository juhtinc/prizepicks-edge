/**
 * api/lore.js  →  /api/lore
 * Single serverless function router for ALL Sports Lore endpoints.
 * Consolidates 20 endpoints into 1 function to stay within Vercel Hobby plan
 * limit of 12 serverless functions.
 *
 * Routes are determined by the ?route= query parameter:
 *   POST /api/lore?route=weekly-batch&phase=stories&batch=A
 *   POST /api/lore?route=generate-metadata
 *   POST /api/lore?route=optimize-hook
 *   POST /api/lore?route=select-music
 *   POST /api/lore?route=clip-sourcer
 *   POST /api/lore?route=video-production
 *   POST /api/lore?route=analytics
 *   POST /api/lore?route=performance-check
 *   POST /api/lore?route=comments
 *   POST /api/lore?route=cross-post
 *   POST /api/lore?route=post-schedule
 *   POST /api/lore?route=ab-test
 *   POST /api/lore?route=render-fallback
 *   GET  /api/lore?route=batch-control
 *   GET  /api/lore?route=clip-feedback
 *   GET  /api/lore?route=clip-review
 *   GET  /api/lore?route=cron-lore
 */

// Lazy-load handlers to avoid loading all modules on every request
const handlers = {
  "weekly-batch":      () => require("./lore/weekly-batch"),
  "generate-metadata": () => require("./lore/generate-metadata"),
  "optimize-hook":     () => require("./lore/optimize-hook"),
  "select-music":      () => require("./lore/select-music"),
  "clip-sourcer":      () => require("./lore/clip-sourcer"),
  "video-production":  () => require("./lore/video-production"),
  "analytics":         () => require("./lore/analytics"),
  "performance-check": () => require("./lore/performance-check"),
  "comments":          () => require("./lore/comments"),
  "cross-post":        () => require("./lore/cross-post"),
  "post-schedule":     () => require("./lore/post-schedule"),
  "ab-test":           () => require("./lore/ab-test"),
  "render-fallback":   () => require("./lore/render-fallback"),
  "batch-control":     () => require("./lore/batch-control"),
  "clip-feedback":     () => require("./lore/clip-feedback"),
  "clip-review":       () => require("./lore/clip-review"),
  "cron-lore":         () => require("./lore/cron-lore"),
  "generate-thumbnail":() => require("./lore/generate-thumbnail"),
};

module.exports = async function handler(req, res) {
  const route = req.query.route;

  if (!route) {
    return res.status(200).json({
      ok: true,
      service: "Sports Lore Pipeline",
      routes: Object.keys(handlers),
      usage: "Add ?route=<name> to access an endpoint",
    });
  }

  const getHandler = handlers[route];
  if (!getHandler) {
    return res.status(404).json({ error: `Unknown route: ${route}`, available: Object.keys(handlers) });
  }

  // Forward all query params (except route) so they work as expected
  // e.g., ?route=weekly-batch&phase=stories&batch=A
  try {
    const handler = getHandler();
    return await handler(req, res);
  } catch (e) {
    console.error(`[lore-router] Error in ${route}:`, e.message);
    return res.status(500).json({ error: e.message, route });
  }
};
