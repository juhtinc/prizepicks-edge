# Video Composer v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework `video-composer.js` so rendered videos visually match the HTML preview in `scripts/example-preview-v2.html`.

**Architecture:** Single-file rewrite of the `composeVideo` function in `lib/lore/lib/video-composer.js`. All 12 tracks are built sequentially in the function body. New helper functions added for reveal type detection and reveal element construction.

**Tech Stack:** Node.js, Creatomate JSON source API (renderComposition)

**Spec:** `docs/superpowers/specs/2026-03-30-video-composer-v2-design.md`

**Reference:** `scripts/example-preview-v2.html` (open in browser to see target visuals)

---

### Task 1: Add reveal type detection helpers

**Files:**
- Modify: `lib/lore/lib/video-composer.js:38-72`

- [ ] **Step 1: Replace `extractStatFromText` with two new helpers**

Replace the existing `extractStatFromText` function and add a new `isStatReveal` function. Keep `isRevealSegment` unchanged.

```javascript
/**
 * Determine if reveal text is a stat (big number) vs a quote (text message).
 * Stats: start with a digit or contain "NUM UNIT" patterns like "26 PPG".
 * Everything else is a quote reveal.
 */
function isStatReveal(text) {
  if (!text) return false;
  const t = text.trim();
  if (/^\d/.test(t)) return true;
  if (/(\d[\d,.]+)\s*(points?|ppg|rpg|apg|bpg|spg|%|games?|seasons?|wins?|losses?)/i.test(t)) return true;
  return false;
}

/**
 * Extract the main number and unit from stat text.
 * "26 PPG" → { number: "26", unit: "PPG", sublabel: null }
 * "26 PPG · ABA Champion · MVP" → { number: "26", unit: "PPG", sublabel: "ABA Champion · MVP" }
 * "24.6 PPG — 4x All-Star — past his prime" → { number: "24.6", unit: "PPG", sublabel: "4x All-Star · past his prime" }
 */
function parseStatText(text) {
  if (!text) return { number: text || "", unit: "", sublabel: null };
  const m = text.match(/^([\d,.]+)\s*([A-Za-z%]*)/);
  if (!m) return { number: text, unit: "", sublabel: null };
  const number = m[1];
  const unit = m[2] || "";
  // Everything after the first separator (·, —, -, ,) is sublabel
  const rest = text.slice(m[0].length).replace(/^\s*[·—\-,]\s*/, "").trim();
  const sublabel = rest || null;
  return { number, unit, sublabel };
}
```

- [ ] **Step 2: Verify the file still exports correctly**

Run: `node -e "const vc = require('./lib/lore/lib/video-composer.js'); console.log(typeof vc.composeVideo)"`
Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add lib/lore/lib/video-composer.js
git commit -m "refactor(lore): add stat vs quote reveal detection helpers"
```

---

### Task 2: Rework background footage layer (Track 1)

**Files:**
- Modify: `lib/lore/lib/video-composer.js:107-142` (the Track 1 loop)

- [ ] **Step 1: Replace the reveal branch**

Currently reveal segments create a solid `#0a0a0a` shape. Change them to use a video element with blur and darkening. Replace the entire Track 1 loop body:

```javascript
// ── Track 1: Background footage layers (one per segment) ──
const bgTrack = trackCounter++;
for (let i = 0; i < segs.length; i++) {
  const seg = segs[i];
  const duration = seg.end - seg.start;
  if (duration <= 0) continue;

  const videoEl = {
    type: "video",
    track: bgTrack,
    time: seg.start,
    duration: duration,
    source: pickFootageUrl(i, clipUrls),
    loop: true,
    fit: "cover",
    width: WIDTH,
    height: HEIGHT,
  };

  if (isRevealSegment(seg)) {
    // Blur and dim the footage during reveals
    videoEl.blur_radius = 20;
    videoEl.color_overlay = "rgba(0,0,0,0.7)";
  }

  elements.push(videoEl);
}
```

- [ ] **Step 2: Verify module loads**

Run: `node -e "const vc = require('./lib/lore/lib/video-composer.js'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add lib/lore/lib/video-composer.js
git commit -m "feat(lore): blur footage during reveals instead of solid black"
```

---

### Task 3: Add vignette overlay (new Track 2)

**Files:**
- Modify: `lib/lore/lib/video-composer.js` — insert after Track 1, before the existing gradient track

- [ ] **Step 1: Add vignette shape element**

Insert this block right after the Track 1 loop closes, before the existing gradient overlay:

```javascript
// ── Track 2: Vignette overlay (radial dark edges) ──
const vignetteTrack = trackCounter++;
elements.push({
  type: "shape",
  track: vignetteTrack,
  time: 0,
  duration: totalDuration,
  width: WIDTH,
  height: HEIGHT,
  x: WIDTH / 2,
  y: HEIGHT / 2,
  fill_mode: "radial",
  fill_color: ["rgba(0,0,0,0)", "rgba(0,0,0,0.7)"],
  fill_x0: "50%",
  fill_y0: "40%",
  fill_radius: "70%",
});
```

- [ ] **Step 2: Verify module loads**

Run: `node -e "const vc = require('./lib/lore/lib/video-composer.js'); console.log('ok')"`

- [ ] **Step 3: Commit**

```bash
git add lib/lore/lib/video-composer.js
git commit -m "feat(lore): add vignette overlay for cinematic dark edges"
```

---

### Task 4: Tune bottom fade gradient (Track 3)

**Files:**
- Modify: `lib/lore/lib/video-composer.js` — the existing gradient shape element

- [ ] **Step 1: Update gradient fill_color**

Change the existing gradient overlay's `fill_color` from:
```
"linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0.85) 100%)"
```
to:
```
"linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.9) 100%)"
```

- [ ] **Step 2: Commit**

```bash
git add lib/lore/lib/video-composer.js
git commit -m "fix(lore): tune bottom fade gradient to match preview"
```

---

### Task 5: Skip captions during reveals (Track 5)

**Files:**
- Modify: `lib/lore/lib/video-composer.js` — the caption track loop

- [ ] **Step 1: Add reveal skip condition**

In the caption track loop, add a check to skip reveal segments. Change:

```javascript
if (duration <= 0 || !seg.text) continue;
```

to:

```javascript
if (duration <= 0 || !seg.text || isRevealSegment(seg)) continue;
```

- [ ] **Step 2: Commit**

```bash
git add lib/lore/lib/video-composer.js
git commit -m "fix(lore): hide captions during reveal segments"
```

---

### Task 6: Rework reveal overlays with stat/quote distinction (Track 6)

**Files:**
- Modify: `lib/lore/lib/video-composer.js` — replace the entire reveal track section

- [ ] **Step 1: Replace the reveal track loop**

Replace the entire Track 5 (old reveal track) section with the new implementation. This is the biggest change. The new reveal track builds 5 elements per reveal segment: top gold line, eyebrow, main content, attribution, bottom gold line.

```javascript
// ── Track 6: Reveal overlays (stat numbers or quote text + decorative lines) ──
const revealTrack = trackCounter++;
for (let i = 0; i < segs.length; i++) {
  const seg = segs[i];
  const duration = seg.end - seg.start;
  if (duration <= 0 || !isRevealSegment(seg)) continue;

  const displayText = (seg.text || "").trim();

  // Top decorative gold line
  elements.push({
    type: "shape",
    track: revealTrack,
    time: seg.start,
    duration: duration,
    width: WIDTH - 96,
    height: 1,
    x: WIDTH / 2,
    y: 60,
    fill_color: "rgba(245,166,35,0.5)",
    animations: [
      { type: "fade", fade_type: "in", duration: "15%" },
    ],
  });

  // Bottom decorative gold line
  elements.push({
    type: "shape",
    track: revealTrack,
    time: seg.start,
    duration: duration,
    width: WIDTH - 96,
    height: 1,
    x: WIDTH / 2,
    y: HEIGHT - 60,
    fill_color: "rgba(245,166,35,0.5)",
    animations: [
      { type: "fade", fade_type: "in", duration: "15%" },
    ],
  });

  // Eyebrow text (segment name)
  if (seg.name) {
    elements.push({
      type: "text",
      track: revealTrack,
      time: seg.start,
      duration: duration,
      text: seg.name.toUpperCase(),
      font_family: FONT,
      font_weight: "700",
      font_size: 22,
      fill_color: "rgba(245,166,35,0.65)",
      x_alignment: "50%",
      width: "60%",
      y: "38%",
      letter_spacing: "30%",
      animations: [
        { type: "fade", fade_type: "in", duration: "15%" },
        { type: "slide", direction: "up", distance: "1%", duration: "20%" },
      ],
    });
  }

  // Main content — stat or quote
  if (isStatReveal(displayText)) {
    const { number, unit, sublabel } = parseStatText(displayText);

    // Big gold number
    elements.push({
      type: "text",
      track: revealTrack,
      time: seg.start,
      duration: duration,
      text: number,
      font_family: FONT,
      font_weight: "900",
      font_size: 160,
      fill_color: BRAND_GOLD,
      x_alignment: "50%",
      width: "85%",
      y: "45%",
      shadow_color: "rgba(245,166,35,0.4)",
      shadow_blur: 50,
      animations: [
        { type: "scale", start_scale: "88%", duration: "20%", easing: "back-out" },
        { type: "fade", fade_type: "in", duration: "10%" },
      ],
    });

    // Unit label below number
    if (unit) {
      elements.push({
        type: "text",
        track: revealTrack,
        time: seg.start,
        duration: duration,
        text: unit.toUpperCase(),
        font_family: FONT,
        font_weight: "700",
        font_size: 36,
        fill_color: "rgba(245,166,35,0.5)",
        x_alignment: "50%",
        width: "60%",
        y: "52%",
        letter_spacing: "30%",
      });
    }

    // Sublabel (e.g. "ABA Champion · MVP")
    if (sublabel) {
      elements.push({
        type: "text",
        track: revealTrack,
        time: seg.start,
        duration: duration,
        text: sublabel,
        font_family: FONT,
        font_weight: "400",
        font_size: 20,
        fill_color: "rgba(255,255,255,0.3)",
        x_alignment: "50%",
        width: "70%",
        y: "56%",
        letter_spacing: "20%",
      });
    }
  } else {
    // Quote reveal — white uppercase text
    elements.push({
      type: "text",
      track: revealTrack,
      time: seg.start,
      duration: duration,
      text: displayText.toUpperCase(),
      font_family: FONT,
      font_weight: "900",
      font_size: 48,
      fill_color: "#ffffff",
      x_alignment: "50%",
      width: "80%",
      y: "45%",
      line_height: "140%",
      letter_spacing: "5%",
      animations: [
        { type: "scale", start_scale: "88%", duration: "20%", easing: "back-out" },
        { type: "fade", fade_type: "in", duration: "10%" },
      ],
    });
  }

  // Attribution text below
  elements.push({
    type: "text",
    track: revealTrack,
    time: seg.start,
    duration: duration,
    text: seg.attribution || "",
    font_family: FONT,
    font_weight: "600",
    font_size: 18,
    fill_color: "rgba(245,166,35,0.45)",
    x_alignment: "50%",
    width: "60%",
    y: "62%",
    letter_spacing: "25%",
    animations: [
      { type: "fade", fade_type: "in", duration: "20%", start_time: "30%" },
    ],
  });
}
```

- [ ] **Step 2: Verify module loads**

Run: `node -e "const vc = require('./lib/lore/lib/video-composer.js'); console.log('ok')"`

- [ ] **Step 3: Commit**

```bash
git add lib/lore/lib/video-composer.js
git commit -m "feat(lore): rework reveal overlays — stat vs quote distinction + gold lines"
```

---

### Task 7: Reposition lower third to bottom-left (Track 7)

**Files:**
- Modify: `lib/lore/lib/video-composer.js` — the lower third section

- [ ] **Step 1: Update accent bar position**

Change the accent bar shape from `x: "5%", y: "72%"` to:
```javascript
x: "5%",
y: "88%",
```

- [ ] **Step 2: Update eyebrow label position**

Change from `x: "32%", y: "70%"` to:
```javascript
x: "7%",
y: "86%",
```

Also change `width: 500` to `width: 400` and keep `x_alignment: "0%"`.

- [ ] **Step 3: Update player name position**

Change from `x: "34%", y: "74%"` to:
```javascript
x: "7%",
y: "89%",
```

Also change `width: 600` to `width: 500`.

- [ ] **Step 4: Commit**

```bash
git add lib/lore/lib/video-composer.js
git commit -m "fix(lore): reposition lower third to bottom-left matching preview"
```

---

### Task 8: Add phase badge (new Track 8)

**Files:**
- Modify: `lib/lore/lib/video-composer.js` — insert after lower third section, before UI track

- [ ] **Step 1: Add phase badge elements**

Insert this block after the lower third section:

```javascript
// ── Track 8: Phase badge (top-right, one per segment) ──
const badgeTrack = trackCounter++;
for (let i = 0; i < segs.length; i++) {
  const seg = segs[i];
  const duration = seg.end - seg.start;
  if (duration <= 0) continue;

  const phaseName = (seg.name || seg.phase || "").toUpperCase();
  if (!phaseName) continue;

  elements.push({
    type: "text",
    track: badgeTrack,
    time: seg.start,
    duration: duration,
    text: phaseName,
    font_family: FONT,
    font_weight: "800",
    font_size: 18,
    fill_color: "#000000",
    background_color: BRAND_GOLD,
    background_x_padding: "40%",
    background_y_padding: "20%",
    background_border_radius: "8%",
    x_alignment: "100%",
    width: 200,
    height: 40,
    x: "92%",
    y: "2%",
    letter_spacing: "10%",
  });
}
```

- [ ] **Step 2: Verify module loads**

Run: `node -e "const vc = require('./lib/lore/lib/video-composer.js'); console.log('ok')"`

- [ ] **Step 3: Commit**

```bash
git add lib/lore/lib/video-composer.js
git commit -m "feat(lore): add phase badge top-right per segment"
```

---

### Task 9: Update JSDoc header and clean up

**Files:**
- Modify: `lib/lore/lib/video-composer.js:1-13` (file header comment)

- [ ] **Step 1: Update the file header**

Replace the header comment to reflect v2 and the new track layout:

```javascript
/**
 * lib/lore/lib/video-composer.js
 * Builds a dynamic Creatomate JSON composition programmatically (no template_id).
 * Matches the storyboard format from example-preview-v2.html:
 *   - 1080x1920 vertical short, ~55-60s
 *   - 12-track layout: footage → vignette → gradient → flash → captions →
 *     reveal overlays → lower third → phase badge → UI → progress → VO → music
 *   - Reveal segments: blurred/dimmed footage, stat or quote overlay, gold lines
 *   - Phase badge top-right, lower third bottom-left
 *   - Vignette + bottom fade for cinematic look
 */
```

- [ ] **Step 2: Remove the old `extractStatFromText` function if still present**

Delete the function entirely (replaced by `isStatReveal` + `parseStatText` in Task 1).

- [ ] **Step 3: Final verification**

Run: `node -e "const vc = require('./lib/lore/lib/video-composer.js'); console.log('exports:', Object.keys(vc))"`
Expected: `exports: [ 'composeVideo', 'buildSegmentsFromScript' ]`

- [ ] **Step 4: Commit**

```bash
git add lib/lore/lib/video-composer.js
git commit -m "chore(lore): update header and clean up old helpers"
```
