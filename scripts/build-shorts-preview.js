const fs = require("fs");
const path = require("path");
const data = require("./shorts-data.json");

const { textEls, hookStatEls, duration, playerName, storyType, totalEls } = data;
const captionEls = textEls.filter(e => e.font_size === 48 && e.time >= 3);
const hookStatsJSON = JSON.stringify(hookStatEls.map(e => ({ text: e.text, y: e.y, size: e.font_size })));
const capsJSON = JSON.stringify(captionEls.map(e => ({ time: e.time, dur: e.duration, text: e.text, gold: e.fill_color === "#F5A623" })));
const storyLabel = storyType.replace(/_/g, " ").toUpperCase();

const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>YouTube Shorts Preview — ${playerName}</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:'Montserrat',sans-serif}
.wrapper{display:flex;flex-direction:column;align-items:center;gap:14px}

/* iPhone shell */
.iphone{width:375px;height:812px;border-radius:44px;border:4px solid #2a2a2a;position:relative;overflow:hidden;background:#000;box-shadow:0 40px 100px rgba(0,0,0,.9),0 0 0 2px #111}
.dynamic-island{position:absolute;top:12px;left:50%;transform:translateX(-50%);width:120px;height:36px;background:#1a1a1a;border-radius:20px;z-index:102}

/* Status bar */
.status-bar{position:absolute;top:0;left:0;right:0;height:54px;z-index:100;display:flex;justify-content:space-between;align-items:flex-end;padding:0 28px 8px}
.status-time{font-size:15px;font-weight:600;color:#fff}
.status-icons{display:flex;gap:5px;align-items:center;font-size:12px;color:#fff}

/* Video area */
.vid{position:absolute;inset:0;overflow:hidden}
.footage{position:absolute;inset:0;background:linear-gradient(148deg,#1e1400,#0d0a00 45%,#1a1200)}
.dim{position:absolute;inset:0;background:rgba(0,0,0,0.85);transition:opacity .3s}
.vignette{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 40%,transparent 20%,rgba(0,0,0,.7) 100%)}
.bot-fade{position:absolute;bottom:0;left:0;right:0;height:45%;background:linear-gradient(0deg,rgba(0,0,0,.95) 0%,rgba(0,0,0,.5) 40%,transparent 100%)}

.gold-line{position:absolute;left:20px;right:20px;height:1px;background:linear-gradient(90deg,transparent,rgba(245,166,35,.5),transparent);transition:opacity .3s}
.hook-stat{position:absolute;left:50%;transform:translateX(-50%);text-align:center;transition:opacity .3s}
.hook-stat .num{font-weight:900;color:#F5A623;line-height:1;text-shadow:0 0 50px rgba(245,166,35,.4)}
.hook-stat .unit{font-size:14px;font-weight:700;color:rgba(245,166,35,.5);letter-spacing:3px;margin-top:4px}
.psub{position:absolute;left:50%;transform:translateX(-50%);font-size:11px;color:rgba(255,255,255,.3);letter-spacing:2px;transition:opacity .3s}

.caption{position:absolute;left:43%;top:42%;transform:translate(-50%,-50%);width:70%;text-align:center;font-size:17px;font-weight:800;line-height:1.35;text-shadow:0 2px 10px rgba(0,0,0,1),0 0 20px rgba(0,0,0,.6);transition:opacity .15s}
.caption.gold{color:#F5A623}.caption.white{color:#fff}

.lt{position:absolute;left:14px;bottom:175px;transition:opacity .3s}
.lt-eye{font-size:8px;color:rgba(245,166,35,.7);letter-spacing:2.5px;display:flex;align-items:center;gap:5px}
.lt-eye::before{content:'';width:12px;height:1px;background:#F5A623}
.lt-name{font-size:14px;font-weight:900;color:#fff;margin-top:3px;text-shadow:0 2px 8px rgba(0,0,0,1)}
.logo{position:absolute;top:58px;left:14px;font-size:8px;font-weight:800;color:rgba(245,166,35,.7);letter-spacing:2px;background:rgba(0,0,0,.4);padding:3px 7px;border-radius:4px;z-index:50}

/* YouTube Shorts UI */
.yt-r{position:absolute;right:12px;bottom:180px;display:flex;flex-direction:column;align-items:center;gap:20px;z-index:50}
.yt-b{display:flex;flex-direction:column;align-items:center;gap:3px}
.yt-b svg{width:28px;height:28px;fill:#fff;filter:drop-shadow(0 1px 3px rgba(0,0,0,.8))}
.yt-b span{font-size:10px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8)}
.yt-av{width:36px;height:36px;border-radius:50%;border:2px solid #F5A623;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#222}
.yt-av span{font-size:10px;font-weight:900;color:#F5A623}
.yt-plus{position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);width:16px;height:16px;background:#F5A623;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;color:#000;font-weight:900;line-height:1}

.yt-bot{position:absolute;bottom:16px;left:12px;right:60px;z-index:50}
.yt-ch{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.yt-ch-name{font-size:13px;font-weight:700;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.8)}
.yt-sub{font-size:10px;background:rgba(255,255,255,.15);color:#fff;padding:3px 10px;border-radius:12px;font-weight:600}
.yt-desc{font-size:11px;color:rgba(255,255,255,.8);line-height:1.3;text-shadow:0 1px 3px rgba(0,0,0,.8);margin-bottom:4px;max-height:30px;overflow:hidden}
.yt-music{display:flex;align-items:center;gap:6px;font-size:10px;color:rgba(255,255,255,.6)}
.yt-music svg{width:12px;height:12px;fill:rgba(255,255,255,.6)}

.progress{position:absolute;bottom:0;left:0;right:0;height:3px;background:rgba(255,255,255,.1);z-index:60}
.progress-fill{height:100%;background:#F5A623;transition:width .1s linear}

.ctrl{display:flex;gap:8px}
.ctrl button{padding:8px 20px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;border:none;letter-spacing:1px;font-family:inherit}
.ctrl .play{background:#F5A623;color:#000}
.ctrl .rst{background:rgba(255,255,255,.06);color:#666;border:1px solid rgba(255,255,255,.08)}
.timer{font-size:11px;color:#555}.timer span{color:#F5A623;font-weight:700}
</style></head><body>
<div class="wrapper">
<div class="iphone">
  <div class="dynamic-island"></div>
  <div class="status-bar">
    <span class="status-time">9:41</span>
    <div class="status-icons">
      <span>&#9679;&#9679;&#9679;&#9679;</span>
      <span>WiFi</span>
      <span>100%</span>
    </div>
  </div>
  <div class="vid">
    <div class="footage"></div>
    <div class="dim" id="dim" style="opacity:0"></div>
    <div class="vignette"></div>
    <div class="bot-fade"></div>
    <div class="gold-line" id="gT" style="top:60px;opacity:0"></div>
    <div class="gold-line" id="gB" style="bottom:200px;opacity:0"></div>
    <div class="hook-stat" id="s1" style="opacity:0"></div>
    <div class="hook-stat" id="s2" style="opacity:0"></div>
    <div class="psub" id="psub" style="opacity:0;bottom:210px">${playerName.toUpperCase()}</div>
    <div class="caption" id="cap" style="opacity:0"></div>
    <div class="lt" id="lt" style="opacity:0">
      <div class="lt-eye">${storyLabel}</div>
      <div class="lt-name">${playerName.toUpperCase()}</div>
    </div>
    <div class="logo">SPORTS LORE</div>
  </div>

  <div class="yt-r">
    <div class="yt-b"><svg viewBox="0 0 24 24"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg><span>2.4K</span></div>
    <div class="yt-b"><svg viewBox="0 0 24 24" style="transform:scaleY(-1)"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg><span>Dislike</span></div>
    <div class="yt-b"><svg viewBox="0 0 24 24"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/></svg><span>348</span></div>
    <div class="yt-b"><svg viewBox="0 0 24 24"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg><span>Share</span></div>
    <div class="yt-b" style="position:relative">
      <div class="yt-av"><span>SL</span></div>
      <div class="yt-plus">+</div>
    </div>
  </div>

  <div class="yt-bot">
    <div class="yt-ch">
      <span class="yt-ch-name">@SportsLore1</span>
      <span class="yt-sub">Subscribe</span>
    </div>
    <div class="yt-desc">He Scored 50 In The Finals Nobody Remembers #shorts #nba #basketball</div>
    <div class="yt-music"><svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>Original Sound — Sports Lore</div>
  </div>

  <div class="progress"><div class="progress-fill" id="prog"></div></div>
</div>
<div class="ctrl">
  <button class="rst" onclick="reset()">Reset</button>
  <button class="play" id="pb" onclick="toggle()">Play</button>
</div>
<div class="timer"><span id="tL">0.0s</span> / ${duration}s</div>
</div>

<script>
const D=${duration},H=3;
const hs=${hookStatsJSON};
const cs=${capsJSON};
let p=false,t=0,iv=null;

function r(t){
  document.getElementById('tL').textContent=t.toFixed(1)+'s';
  document.getElementById('prog').style.width=(t/D*100)+'%';
  const inH=t<H;
  document.getElementById('dim').style.opacity=inH&&hs.length?1:0;
  document.getElementById('gT').style.opacity=inH&&hs.length?1:0;
  document.getElementById('gB').style.opacity=inH&&hs.length?1:0;
  document.getElementById('psub').style.opacity=inH&&hs.length?1:0;
  hs.forEach((s,i)=>{const el=document.getElementById('s'+(i+1));if(!el)return;el.style.opacity=inH?1:0;el.style.top=(parseFloat(s.y)||(i?50:34))+'%';el.innerHTML='<div class="num" style="font-size:'+(s.size*.55)+'px">'+s.text+'</div>';});
  document.getElementById('lt').style.opacity=t>=H?1:0;
  const c=document.getElementById('cap');
  const a=cs.find(e=>t>=e.time&&t<e.time+e.dur);
  if(a){c.style.opacity=1;c.textContent=a.text;c.className='caption '+(a.gold?'gold':'white');}else{c.style.opacity=0;}
}
function tick(){t+=.1;if(t>=D){stop();return;}r(t);}
function toggle(){if(p)stop();else{p=true;document.getElementById('pb').textContent='Pause';iv=setInterval(tick,100);}}
function stop(){p=false;if(iv)clearInterval(iv);iv=null;document.getElementById('pb').textContent='Play';}
function reset(){stop();t=0;r(0);}
r(0);
</script></body></html>`;

fs.writeFileSync(path.join(__dirname, "shorts-preview.html"), html);
console.log("Written to scripts/shorts-preview.html");
