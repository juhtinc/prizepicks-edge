/**
 * scripts/setup-creatomate.js
 *
 * Creates the two Creatomate templates needed for Sports Lore:
 *   1. Video template (55-second vertical Short)
 *   2. Thumbnail template (1080x1920 static image)
 *
 * Usage:
 *   CREATOMATE_API_KEY=your_key node scripts/setup-creatomate.js
 *
 * After running, copy the two template IDs into your Vercel env vars:
 *   CREATOMATE_VIDEO_TEMPLATE_ID=...
 *   CREATOMATE_THUMBNAIL_TEMPLATE_ID=...
 */

const axios = require("axios");

const API_KEY = process.env.CREATOMATE_API_KEY;
if (!API_KEY) {
  console.error("Error: Set CREATOMATE_API_KEY environment variable first.");
  console.error("Usage: CREATOMATE_API_KEY=your_key node scripts/setup-creatomate.js");
  process.exit(1);
}

const BASE = "https://api.creatomate.com/v1";
const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

// ─── Helper: Generate rotating clip layers ───

function generateClipLayers(count, durationEach) {
  const overlap = 0.3; // crossfade overlap in seconds
  const layers = [];
  for (let i = 0; i < count; i++) {
    const startTime = i * (durationEach - overlap);
    layers.push({
      type: "video",
      name: `clip_${i + 1}`,
      source: "",  // Filled at render time with Pexels/stock clip URL
      width: "100%",
      height: "100%",
      x: "50%",
      y: "50%",
      fit: "cover",
      time: startTime,
      duration: durationEach,
      // Ken Burns zoom effect — each clip slowly zooms in for motion
      animations: [
        {
          type: "scale",
          fade: false,
          scope: "element",
          start_scale: "100%",
          end_scale: "110%",
          duration: durationEach,
          easing: "linear",
        },
        // Crossfade in (except first clip)
        ...(i > 0 ? [{
          type: "fade",
          fade: true,
          duration: overlap,
        }] : []),
      ],
    });
  }
  return layers;
}

// ─── Template 1: Video (55-second vertical Short) ───

const videoTemplate = {
  name: "Sports Lore — Video Short",
  width: 1080,
  height: 1920,
  duration: 55,
  snapshot_time: 3,
  elements: [
    // Background: dark gradient
    {
      type: "shape",
      name: "background",
      width: "100%",
      height: "100%",
      x: "50%",
      y: "50%",
      fill_color: ["#0a0a1a", "#1a1a3e"],
    },
    // ── Rotating clip layers with variable pacing ──
    // Template has 25 clip slots to accommodate all story types.
    // The pipeline fills clip_1 through clip_N based on story template pacing.
    // Unused slots (no source URL) are automatically hidden by Creatomate.
    // Pacing varies: fast segments get 1.5s clips, slow segments get 3.5s clips.
    ...generateClipLayers(25, 2.2),  // 25 slots at avg 2.2s (covers variable pacing)
    // Dark overlay on clip for text readability
    {
      type: "shape",
      name: "clip_overlay",
      width: "100%",
      height: "100%",
      x: "50%",
      y: "50%",
      fill_color: "rgba(0,0,0,0.3)",
    },
    // Hook text: big bold text for first 3 seconds
    {
      type: "text",
      name: "hook_text",
      text: "The hook line goes here",
      width: "85%",
      x: "50%",
      y: "45%",
      x_alignment: "50%",
      y_alignment: "50%",
      font_family: "Montserrat",
      font_weight: "800",
      font_size: "7.5 vmin",
      fill_color: "#ffffff",
      shadow_color: "rgba(0,0,0,0.8)",
      shadow_blur: "2 vmin",
      text_alignment: "center",
      time: 0,
      duration: 3,
      animations: [
        { type: "scale", fade: false, scope: "element", start_scale: "120%", end_scale: "100%", duration: 0.5 },
        { type: "fade", fade: true, duration: 0.3 },
      ],
    },
    // ── Word-by-word captions ──
    // SAFE ZONE: YouTube Shorts overlays UI in these areas:
    //   Top 12%  — search bar, notifications
    //   Bottom 20% — channel name, description, sound
    //   Right 15% — like/comment/share/remix buttons
    // Captions sit at 42% Y (center-safe) with 70% width (avoids right buttons)
    {
      type: "text",
      name: "captions",
      text: "",
      width: "70%",
      x: "43%",        // Slightly left of center to avoid right-side buttons
      y: "42%",         // Center of safe zone (between 12% and 80%)
      x_alignment: "50%",
      y_alignment: "50%",
      font_family: "Montserrat",
      font_weight: "800",
      font_size: "6 vmin",
      fill_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width: "0.3 vmin",
      shadow_color: "rgba(0,0,0,0.9)",
      shadow_blur: "1.5 vmin",
      text_alignment: "center",
      line_height: "130%",
      time: 0,
      duration: 55,
    },
    // Hero stat text — giant centered number that appears for big stats
    {
      type: "text",
      name: "hero_stat",
      text: "",  // Filled dynamically (e.g., "100" for Wilt's 100-point game)
      width: "90%",
      x: "50%",
      y: "45%",
      x_alignment: "50%",
      y_alignment: "50%",
      font_family: "Montserrat",
      font_weight: "900",
      font_size: "18 vmin",
      fill_color: "#FFD700",
      stroke_color: "#000000",
      stroke_width: "0.5 vmin",
      text_alignment: "center",
      time: 0,
      duration: 0,  // Set dynamically per render
    },
    // ── SFX audio layers ──
    // Up to 5 SFX slots, filled dynamically by the pipeline
    {
      type: "audio",
      name: "sfx_1",
      source: "",
      volume: "35%",
      time: 0,
      duration: 1,
    },
    {
      type: "audio",
      name: "sfx_2",
      source: "",
      volume: "35%",
      time: 0,
      duration: 1,
    },
    {
      type: "audio",
      name: "sfx_3",
      source: "",
      volume: "35%",
      time: 0,
      duration: 1,
    },
    // ── Background music track 2 (for dual-track emotional arc) ──
    {
      type: "audio",
      name: "background_music_2",
      source: "",  // Second mood track, fades in at the music shift point
      volume: "25%",
      audio_fade_in: "1s",
      audio_fade_out: "3s",
      time: 25,  // Default shift time, overridden per render
      duration: 30,
    },
    // Player name: appears AFTER hook (3s), positioned in safe zone
    // Bottom 20% is YouTube UI — player name sits at 72% (just above danger zone)
    {
      type: "text",
      name: "player_name",
      text: "Player Name",
      width: "70%",
      x: "43%",         // Left of center to avoid right buttons
      y: "72%",          // Above the bottom 20% YouTube overlay zone
      x_alignment: "50%",
      y_alignment: "50%",
      font_family: "Montserrat",
      font_weight: "700",
      font_size: "4.5 vmin",
      fill_color: "#ffffff",
      background_color: "rgba(255,68,68,0.85)",
      background_x_padding: "3 vmin",
      background_y_padding: "1.5 vmin",
      background_border_radius: "1 vmin",
      text_alignment: "center",
      time: 3,         // Appears after hook, not at start
      duration: 52,    // Shows from 3s to 55s
      animations: [
        { type: "slide", fade: true, direction: "up", duration: 0.4 },
      ],
    },
    // Channel watermark — top left (safe zone), subtle
    {
      type: "text",
      name: "watermark",
      text: "COLD VAULT",
      x: "14%",
      y: "5%",
      x_alignment: "50%",
      y_alignment: "50%",
      font_family: "Montserrat",
      font_weight: "700",
      font_size: "2 vmin",
      fill_color: "rgba(255,255,255,0.35)",
      text_alignment: "center",
      time: 0,
      duration: 55,
    },
    // ── Player portrait image (Wikipedia/ESPN photo) ──
    // Appears briefly after player is introduced (3s-6s), then during reveals.
    // Ken Burns slow zoom. Semi-transparent so it doesn't overpower the clip.
    {
      type: "image",
      name: "player_portrait",
      source: "",  // Filled at render time with Wikipedia/ESPN image URL
      width: "35%",
      height: "25%",
      x: "22%",
      y: "60%",
      fit: "cover",
      border_radius: "2 vmin",
      opacity: "85%",
      shadow_color: "rgba(0,0,0,0.6)",
      shadow_blur: "2 vmin",
      time: 3,       // Appears after hook, when player name shows
      duration: 4,   // Shows for 4 seconds (3s-7s) during introduction
      animations: [
        { type: "scale", fade: false, scope: "element", start_scale: "100%", end_scale: "108%", duration: 4 },
        { type: "fade", fade: true, duration: 0.4 },
      ],
    },
    // Voiceover audio (dynamic — replaced at render time)
    {
      type: "audio",
      name: "voiceover",
      source: "",  // Filled at render time with ElevenLabs audio URL
      volume: "100%",
      time: 0,
    },
    // Background music (dynamic — replaced at render time)
    {
      type: "audio",
      name: "background_music",
      source: "",  // Filled at render time with Mubert/library track URL
      volume: "25%",
      audio_fade_in: "3s",
      audio_fade_out: "3s",
      time: 0,
      duration: 55,
    },
  ],
};

// ─── Template 2: Thumbnail (1080x1920 static image) ───

const thumbnailTemplate = {
  name: "Sports Lore — Thumbnail",
  width: 1080,
  height: 1920,
  // No duration = static image output
  output_format: "jpg",
  elements: [
    // Background gradient (dynamic accent color)
    {
      type: "shape",
      name: "background",
      width: "100%",
      height: "100%",
      x: "50%",
      y: "50%",
      fill_color: ["#FF4444", "#1a1a3e"],
    },
    // Accent color overlay shape
    {
      type: "shape",
      name: "accent_shape",
      width: "110%",
      height: "50%",
      x: "50%",
      y: "80%",
      fill_color: "#FF4444",  // Dynamic — replaced at render time
      rotation: "-5",
    },
    // Player image (dynamic — replaced at render time)
    {
      type: "image",
      name: "player_image",
      source: "",  // Filled at render time with player photo URL
      width: "90%",
      height: "60%",
      x: "50%",
      y: "40%",
      fit: "cover",
      border_radius: "2 vmin",
    },
    // Player name — big bold
    {
      type: "text",
      name: "player_name",
      text: "PLAYER NAME",
      width: "85%",
      x: "50%",
      y: "75%",
      x_alignment: "50%",
      y_alignment: "50%",
      font_family: "Montserrat",
      font_weight: "900",
      font_size: "9 vmin",
      fill_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width: "0.4 vmin",
      text_transform: "uppercase",
      text_alignment: "center",
    },
    // Hook text — shorter punch line
    {
      type: "text",
      name: "hook_text",
      text: "Hook text here",
      width: "80%",
      x: "50%",
      y: "87%",
      x_alignment: "50%",
      y_alignment: "50%",
      font_family: "Montserrat",
      font_weight: "700",
      font_size: "5 vmin",
      fill_color: "#FFD700",
      text_alignment: "center",
    },
    // ColdVault branding
    {
      type: "text",
      name: "brand",
      text: "COLD VAULT",
      x: "50%",
      y: "5%",
      x_alignment: "50%",
      y_alignment: "50%",
      font_family: "Montserrat",
      font_weight: "800",
      font_size: "3.5 vmin",
      fill_color: "rgba(255,255,255,0.8)",
      text_alignment: "center",
    },
  ],
};

// ─── Create both templates ───

async function createTemplate(template) {
  try {
    const resp = await axios.post(`${BASE}/templates`, template, { headers });
    return resp.data;
  } catch (e) {
    const detail = e.response?.data || e.message;
    console.error(`Failed to create template "${template.name}":`, JSON.stringify(detail, null, 2));
    return null;
  }
}

async function main() {
  console.log("Creating Sports Lore templates in Creatomate...\n");

  console.log("1/2  Creating Video template...");
  const video = await createTemplate(videoTemplate);
  if (video) {
    console.log(`     ✓ Created: ${video.name}`);
    console.log(`     Template ID: ${video.id}\n`);
  }

  console.log("2/2  Creating Thumbnail template...");
  const thumb = await createTemplate(thumbnailTemplate);
  if (thumb) {
    console.log(`     ✓ Created: ${thumb.name}`);
    console.log(`     Template ID: ${thumb.id}\n`);
  }

  if (video && thumb) {
    console.log("═══════════════════════════════════════════════");
    console.log("  Add these to your Vercel environment variables:");
    console.log("═══════════════════════════════════════════════");
    console.log(`  CREATOMATE_VIDEO_TEMPLATE_ID=${video.id}`);
    console.log(`  CREATOMATE_THUMBNAIL_TEMPLATE_ID=${thumb.id}`);
    console.log("═══════════════════════════════════════════════\n");
    console.log("You can further customize these templates in the");
    console.log("Creatomate visual editor at https://creatomate.com/templates");
  }
}

main();
