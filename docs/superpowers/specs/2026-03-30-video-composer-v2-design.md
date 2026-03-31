# Video Composer v2 — Match HTML Preview

**Date:** 2026-03-30
**Scope:** `lib/lore/lib/video-composer.js` only
**Reference:** `scripts/example-preview-v2.html` (Connie Hawkins preview)

## Problem

The current video-composer.js produces videos that don't visually match the HTML preview mockup. Key differences: reveals use solid black instead of blurred footage, captions overlap reveals, no vignette/phase badge, lower third is mispositioned.

## Design

All changes are in `video-composer.js`. The composition builds a 1080x1920 vertical MP4 with the following track layout:

### Track Layout (12 tracks)

| Track | Element | Changes |
|-------|---------|---------|
| 1 | Background footage | Reveal segments: keep video but add `blur_radius: 20` + `color_overlay: "rgba(0,0,0,0.7)"` instead of solid black shape |
| 2 | Vignette overlay (NEW) | Full-duration shape, `fill_mode: "radial"`, transparent center → `rgba(0,0,0,0.7)` edges, center at 50%/40% |
| 3 | Bottom fade gradient | Tune to `rgba(0,0,0,0.9)` bottom, `rgba(0,0,0,0.4)` mid, transparent top |
| 4 | Cut flash transitions | No changes |
| 5 | Caption text | Skip reveal segments entirely (captions hidden during reveals) |
| 6 | Reveal overlays | Distinguish stat vs quote; add eyebrow text; add decorative gold horizontal lines |
| 7 | Lower third | Reposition to bottom-left: accent bar x=5%/y=88%, eyebrow x=7%/y=86%, name x=7%/y=89% |
| 8 | Phase badge (NEW) | Per-segment text element, top-right, gold background, black text, pill shape |
| 9 | UI (logo + handle) | No changes |
| 10 | Progress bar | No changes |
| 11 | Voiceover audio | No changes |
| 12 | Background music | No changes |

### Reveal Detection: Stat vs Quote

```
isStatReveal(text):
  - matches /^\d/ or /(\d[\d,.]+)\s*(points?|ppg|rpg|apg|%|games?|seasons?)/i
  → Big gold number (font_size 160), unit label below, sublabel

isQuoteReveal(text):
  - everything else (e.g. "BLACKLISTED", "How many other...")
  → White uppercase text (font_size 48), gold emphasis on key words, italic sublabel
```

### Reveal Overlay Structure (per reveal segment)

1. **Top gold line** — shape, 1px tall, centered horizontally with 48px margin, `rgba(245,166,35,0.5)`, linear gradient transparent→gold→transparent
2. **Eyebrow** — segment name uppercase, small font, `rgba(245,166,35,0.65)`, above main content, fade+slide animation
3. **Main content** — stat number OR quote text, scale-in animation (`start_scale: 88%`, `back-out` easing)
4. **Attribution** — small text below, `rgba(245,166,35,0.45)`, delayed fade-in
5. **Bottom gold line** — mirror of top line

### Phase Badge

- One text element per segment
- Position: top-right (~92% x, 2% y)
- Style: `background_color: "#F5A623"`, `fill_color: "#000000"`, `font_weight: 800`, `font_size: 18`, `background_border_radius: "8%"`, `background_x_padding: "40%"`, `background_y_padding: "20%"`
- Text: segment phase name uppercase (HOOK, GREATNESS, REVEAL, CONTEXT, TURN, etc.)

### Vignette Overlay

- Shape element, full duration
- `fill_mode: "radial"`
- `fill_color: ["rgba(0,0,0,0)", "rgba(0,0,0,0.7)"]`
- `fill_x0: "50%"`, `fill_y0: "40%"`, `fill_radius: "70%"`

### Not Implementing

- **Film grain** — no native Creatomate noise filter
- **Music indicator bars** — debug UI, not for final video
- **Animated word-by-word caption highlighting** — would require per-word elements; keep full-sentence captions for now
