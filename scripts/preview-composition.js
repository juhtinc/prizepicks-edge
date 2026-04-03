/**
 * Generate an interactive HTML preview from a Creatomate composition JSON.
 * Run: node scripts/preview-composition.js [rowId]
 * Opens a browser preview that simulates the video timeline.
 */

const { composeVideo, buildSegmentsFromScript } = require("../lib/lore/lib/video-composer");
const { getStoryTemplate } = require("../lib/lore/lib/story-templates");

// Mock script data for testing (override with real KV data if available)
const MOCK_SCRIPTS = {
  "bob-pettit": {
    playerName: "Bob Pettit",
    storyType: "forgotten_legend",
    playerSport: "NBA",
    hookLine: "This man averaged 26 points and 16 rebounds per game — and nobody remembers his name.",
    script: "Bob Pettit wasn't just great — he was the blueprint. First player ever to score 20,000 NBA points. Back-to-back MVP awards. And in 1958, he dropped 50 points in the clinching Finals game to beat the only team Bill Russell ever lost a championship to. That's a legend. But the St. Louis Hawks moved, the footage faded, and history quietly closed the door. No dynasty. No major market. No SportsCenter era to keep his name alive. Eleven All-Star selections. Zero household name status. That's the real crime here. Was Bob Pettit the most disrespected great of all time — and who do YOU think got robbed worse?",
    description: "Bob Pettit averaged 26 points and 16 rebounds per game for his ENTIRE career.",
    clipBriefs: [],
  },
  "manute-bol": {
    playerName: "Manute Bol",
    storyType: "record_breaker",
    playerSport: "NBA",
    hookLine: "This man blocked 397 shots in one season — and nobody remembers him.",
    script: "Manute Bol stood 7-foot-7. In his 1985-86 rookie season with the Washington Bullets, he recorded 397 blocks — a record that still stands. He averaged 3.34 blocks per game that season. Not Dikembe Mutombo. Not Mark Eaton. Nobody has come close. But here's what makes it even crazier — Bol didn't grow up playing basketball. He grew up herding cattle in Sudan. He learned the game at 18 and was in the NBA by 23. That's not normal development. That's a generational freak of nature who redefined what a defensive presence could be. Will anyone ever block 397 shots in a season again? Drop your answer.",
    description: "Manute Bol's 1985-86 rookie season produced 397 blocks.",
    clipBriefs: [],
  },
};

async function generatePreview(scriptKey) {
  const script = MOCK_SCRIPTS[scriptKey || "bob-pettit"];
  if (!script) {
    console.error("Unknown script key. Available:", Object.keys(MOCK_SCRIPTS).join(", "));
    process.exit(1);
  }

  // Build mock caption groups (simulated word timestamps)
  const words = (script.hookLine + " " + script.script).split(/\s+/).filter(Boolean);
  const wps = 2.4; // words per second (~145 WPM)
  const captionGroups = [];
  let time = 0;
  let group = [];

  for (let i = 0; i < words.length; i++) {
    group.push(words[i]);
    const atSentenceEnd = /[.!?]$/.test(words[i]);
    const nextIsClause = /^(but|and|or|so|because|when|that|—)$/i.test(words[i + 1] || "");

    if (atSentenceEnd || (group.length >= 4 && nextIsClause) || group.length >= 12 || i === words.length - 1) {
      const duration = group.length / wps;
      captionGroups.push({
        text: group.join(" "),
        start: Math.round(time * 100) / 100,
        duration: Math.round((duration + 0.2) * 100) / 100,
        hasEmphasis: group.some(w => /^\d|points?|rebounds?|blocks?|mvp|championship|record|legend|all-star/i.test(w.replace(/[.,!?]/g, ""))),
        words: group.map(w => ({ word: w, isEmphasis: /^\d|points?|rebounds?|blocks?|mvp|championship/i.test(w.replace(/[.,!?]/g, "")) })),
      });
      time += duration;
      group = [];
    }
  }

  const source = await composeVideo({
    script,
    voiceoverUrl: null,
    musicTrackUrl: "https://example.com/music.mp3",
    segments: null,
    captionGroups,
    targetDuration: 55,
  });

  return { source, script, captionGroups };
}

async function buildHTML(scriptKey) {
  const { source, script } = await generatePreview(scriptKey);
  const els = source.elements;

  // Group elements by approximate time for timeline display
  const textEls = els.filter(e => e.type === "text");
  const shapeEls = els.filter(e => e.type === "shape");

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Composition Preview — ${script.playerName}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0a0a; color:#fff; font-family:'Segoe UI',sans-serif; padding:20px; }
h1 { text-align:center; font-size:14px; color:#F5A623; letter-spacing:3px; margin-bottom:4px; }
.sub { text-align:center; color:#555; font-size:11px; margin-bottom:20px; }
.stage { display:flex; gap:30px; justify-content:center; flex-wrap:wrap; }

.phone { width:270px; height:480px; border-radius:20px; border:2px solid #1a1a1a; overflow:hidden; position:relative; background:#111; flex-shrink:0; }
.phone-layer { position:absolute; inset:0; }
.dim-overlay { position:absolute; inset:0; background:rgba(0,0,0,0.85); transition:opacity 0.3s; }
.footage-bg { position:absolute; inset:0; background:linear-gradient(148deg,#1e1400,#0d0a00 45%,#1a1200); }
.vignette { position:absolute; inset:0; background:radial-gradient(ellipse at 50% 40%,transparent 20%,rgba(0,0,0,.7) 100%); }
.bottom-fade { position:absolute; bottom:0; left:0; right:0; height:40%; background:linear-gradient(0deg,rgba(0,0,0,.9) 0%,rgba(0,0,0,.4) 50%,transparent 100%); }
.gold-line { position:absolute; left:24px; right:24px; height:1px; background:linear-gradient(90deg,transparent,rgba(245,166,35,.5),transparent); }

.hook-stat { position:absolute; left:50%; transform:translateX(-50%); text-align:center; transition:opacity 0.3s; }
.hook-stat .num { font-weight:900; color:#F5A623; line-height:1; text-shadow:0 0 50px rgba(245,166,35,.4); }
.hook-stat .unit { font-size:12px; font-weight:700; color:rgba(245,166,35,.5); letter-spacing:3px; margin-top:2px; }

.caption { position:absolute; left:43%; top:42%; transform:translate(-50%,-50%); width:70%; text-align:center; font-size:15px; font-weight:800; line-height:1.35; text-shadow:0 2px 8px rgba(0,0,0,1); transition:opacity 0.3s; }
.caption.gold { color:#F5A623; }
.caption.white { color:#fff; }

.lower-third { position:absolute; left:14px; transition:opacity 0.3s; }
.lt-eyebrow { font-size:7px; color:rgba(245,166,35,.7); letter-spacing:2px; display:flex; align-items:center; gap:4px; }
.lt-eyebrow::before { content:''; width:10px; height:1px; background:#F5A623; }
.lt-name { font-size:13px; font-weight:900; color:#fff; margin-top:2px; text-shadow:0 2px 6px rgba(0,0,0,1); }

.logo { position:absolute; top:10px; left:10px; font-size:7px; font-weight:800; color:rgba(245,166,35,.7); letter-spacing:2px; background:rgba(0,0,0,.4); padding:2px 5px; border-radius:3px; }
.handle { position:absolute; bottom:6px; right:8px; font-size:7px; color:rgba(255,255,255,.3); }
.progress { position:absolute; bottom:0; left:0; right:0; height:2px; background:rgba(255,255,255,.06); }
.progress-fill { height:100%; background:#F5A623; width:0; transition:width 0.1s linear; }

.player-sub { position:absolute; left:50%; transform:translateX(-50%); font-size:10px; color:rgba(255,255,255,.3); letter-spacing:2px; }

/* Timeline panel */
.timeline { flex:1; min-width:300px; max-width:500px; }
.tl-header { background:#141414; padding:10px 14px; border-bottom:1px solid #222; border-radius:8px 8px 0 0; display:flex; gap:8px; align-items:center; }
.tl-header h2 { font-size:13px; }
.tl-header .tag { font-size:9px; background:rgba(245,166,35,.15); color:#F5A623; border:1px solid rgba(245,166,35,.25); padding:2px 6px; border-radius:4px; font-weight:700; }
.tl-body { background:#0f0f0f; border:1px solid #1a1a1a; border-radius:0 0 8px 8px; max-height:440px; overflow-y:auto; }
.tl-item { padding:6px 12px; border-bottom:1px solid #151515; font-size:10px; transition:background 0.2s; cursor:pointer; }
.tl-item:hover { background:#1a1410; }
.tl-item.active { background:#1a1410; border-left:2px solid #F5A623; }
.tl-time { color:#F5A623; font-weight:700; font-family:monospace; font-size:9px; }
.tl-type { color:#666; font-size:8px; text-transform:uppercase; letter-spacing:1px; }
.tl-text { color:#bbb; margin-top:2px; }
.tl-text .gold { color:#F5A623; font-weight:700; }

.controls { display:flex; gap:8px; justify-content:center; margin-top:10px; }
.btn { padding:6px 16px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; border:none; letter-spacing:1px; font-family:inherit; }
.btn-play { background:#F5A623; color:#000; }
.btn-reset { background:rgba(255,255,255,.06); color:#666; border:1px solid rgba(255,255,255,.08); }
.info { text-align:center; font-size:10px; color:#444; margin-top:6px; }
.info span { color:#F5A623; font-weight:700; }
.stats { text-align:center; color:#555; font-size:10px; margin-top:16px; }
</style></head><body>

<h1>COMPOSITION PREVIEW</h1>
<p class="sub">${script.playerName} (${script.storyType}) &middot; ${source.elements.length} elements &middot; ${source.duration}s</p>

<div class="stage">
<div>
  <div class="phone" id="phone">
    <div class="footage-bg"></div>
    <div class="dim-overlay" id="dimOverlay" style="opacity:0"></div>
    <div class="vignette"></div>
    <div class="bottom-fade"></div>
    <div class="gold-line" id="goldTop" style="top:25px;opacity:0"></div>
    <div class="gold-line" id="goldBot" style="bottom:55px;opacity:0"></div>
    <div class="hook-stat" id="stat1" style="opacity:0"></div>
    <div class="hook-stat" id="stat2" style="opacity:0"></div>
    <div class="player-sub" id="playerSub" style="opacity:0">${script.playerName.toUpperCase()}</div>
    <div class="caption" id="caption" style="opacity:0"></div>
    <div class="lower-third" id="lt" style="bottom:62px;opacity:0">
      <div class="lt-eyebrow">${(script.storyType || "").replace(/_/g, " ").toUpperCase()}</div>
      <div class="lt-name">${script.playerName.toUpperCase()}</div>
    </div>
    <div class="logo">SPORTS LORE</div>
    <div class="handle">@SportsLore1</div>
    <div class="progress"><div class="progress-fill" id="prog"></div></div>
  </div>
  <div class="controls">
    <button class="btn btn-reset" onclick="reset()">Reset</button>
    <button class="btn btn-play" id="playBtn" onclick="toggle()">Play</button>
  </div>
  <div class="info"><span id="timeLabel">0.0s</span> / ${source.duration}s</div>
</div>

<div class="timeline">
  <div class="tl-header">
    <h2>${script.playerName}</h2>
    <span class="tag">${script.storyType}</span>
    <span class="tag">${source.elements.length} els</span>
  </div>
  <div class="tl-body" id="tlBody">
    ${textEls.map((e, i) => `
    <div class="tl-item" data-time="${e.time}" data-dur="${e.duration}" data-idx="${i}" onclick="seekTo(${e.time})">
      <span class="tl-time">${e.time.toFixed(1)}s</span>
      <span class="tl-type">${e.fill_color === '#F5A623' ? 'gold' : e.fill_color === '#ffffff' ? 'white' : 'ui'} ${e.font_size}px</span>
      <div class="tl-text">${(e.text || '').slice(0, 60)}${(e.text || '').length > 60 ? '...' : ''}</div>
    </div>`).join("")}
  </div>
</div>
</div>

<div class="stats">
  Hook stats found: ${els.filter(e => e.time < 3 && e.fill_color === '#F5A623' && e.type === 'text').map(e => e.text).join(', ') || 'NONE'}<br>
  Caption groups: ${textEls.filter(e => e.time >= 3 && e.font_size === 48).length}<br>
  Lower third: ${textEls.find(e => e.text === script.playerName.toUpperCase() && e.font_size === 40) ? 'YES' : 'NO'}<br>
  Music: ${els.find(e => e.type === 'audio' && e.source?.includes('music')) ? 'YES' : 'NO'}<br>
  Last caption: "${textEls.filter(e => e.font_size === 48).pop()?.text || 'NONE'}"
</div>

<script>
const duration = ${source.duration};
const hookEnd = 3;
const textElements = ${JSON.stringify(textEls.map(e => ({ time: e.time, duration: e.duration, text: e.text, color: e.fill_color, size: e.font_size })))};
const hookStats = ${JSON.stringify(els.filter(e => e.time < 3 && e.fill_color === '#F5A623' && e.type === 'text').map(e => ({ text: e.text, y: e.y, size: e.font_size })))};

let playing = false, currentTime = 0, interval = null;

function render(t) {
  document.getElementById('timeLabel').textContent = t.toFixed(1) + 's';
  document.getElementById('prog').style.width = (t / duration * 100) + '%';

  // Hook phase (0-3s)
  const inHook = t < hookEnd;
  document.getElementById('dimOverlay').style.opacity = inHook && hookStats.length ? 1 : 0;
  document.getElementById('goldTop').style.opacity = inHook && hookStats.length ? 1 : 0;
  document.getElementById('goldBot').style.opacity = inHook && hookStats.length ? 1 : 0;
  document.getElementById('playerSub').style.opacity = inHook && hookStats.length ? 1 : 0;
  document.getElementById('playerSub').style.bottom = hookStats.length <= 1 ? '70px' : '50px';

  // Hook stats
  hookStats.forEach((s, i) => {
    const el = document.getElementById('stat' + (i + 1));
    if (!el) return;
    el.style.opacity = inHook ? 1 : 0;
    const pct = parseFloat(s.y) || (i === 0 ? 34 : 50);
    el.style.top = pct + '%';
    el.innerHTML = '<div class="num" style="font-size:' + (s.size * 0.5) + 'px">' + s.text + '</div>';
  });

  // Lower third (after hook)
  document.getElementById('lt').style.opacity = t >= hookEnd ? 1 : 0;

  // Find active caption
  const cap = document.getElementById('caption');
  const active = textElements.find(e => e.size === 48 && t >= e.time && t < e.time + e.duration);
  if (active) {
    cap.style.opacity = 1;
    cap.textContent = active.text;
    cap.className = 'caption ' + (active.color === '#F5A623' ? 'gold' : 'white');
  } else {
    cap.style.opacity = inHook ? 0 : 0;
  }

  // Highlight timeline
  document.querySelectorAll('.tl-item').forEach(el => {
    const et = parseFloat(el.dataset.time);
    const ed = parseFloat(el.dataset.dur);
    el.classList.toggle('active', t >= et && t < et + ed);
  });
}

function tick() {
  currentTime += 0.1;
  if (currentTime >= duration) { stop(); return; }
  render(currentTime);
}

function toggle() {
  if (playing) stop();
  else { playing = true; document.getElementById('playBtn').textContent = 'Pause'; interval = setInterval(tick, 100); }
}

function stop() {
  playing = false;
  if (interval) clearInterval(interval);
  interval = null;
  document.getElementById('playBtn').textContent = 'Play';
}

function reset() {
  stop();
  currentTime = 0;
  render(0);
}

function seekTo(t) {
  currentTime = t;
  render(t);
}

render(0);
</script>
</body></html>`;

  // Write to file
  const fs = require("fs");
  const outPath = require("path").join(__dirname, "composition-preview.html");
  fs.writeFileSync(outPath, html);
  console.log("Preview written to:", outPath);
  console.log(`Open in browser: file:///${outPath.replace(/\\/g, "/")}`);
  console.log(`\nComposition: ${source.elements.length} elements, ${source.duration}s`);
  console.log(`Hook stats: ${els.filter(e => e.time < 3 && e.fill_color === '#F5A623' && e.type === 'text').map(e => e.text).join(', ') || 'NONE'}`);
}

const key = process.argv[2] || "bob-pettit";
buildHTML(key).catch(e => console.error(e));
