# 🏆 PrizePicks Edge

AI-powered daily prop analyzer. Scrapes live PrizePicks lines (NBA, MLB, NHL, NFL, golf, esports), runs them through Claude AI with web search, and surfaces the best picks with news-backed reasoning.

---

## Quick Start (VSCode → Vercel)

### 1 — Open in VSCode

Unzip this folder, then open the workspace:

```
File → Open Workspace from File → prizepicks-edge.code-workspace
```

Install the recommended extensions when prompted (Prettier, ESLint, Vercel).

---

### 2 — Install dependencies

Open the VSCode terminal (Ctrl+` or Terminal → New Terminal):

```bash
npm install
```

---

### 3 — Add your environment variables

Rename `.env.example` to `.env`, then fill in:

```
ANTHROPIC_API_KEY=sk-ant-...        ← https://console.anthropic.com
KV_REST_API_URL=...                 ← from Vercel KV (Step 6)
KV_REST_API_TOKEN=...               ← from Vercel KV (Step 6)
CRON_SECRET=any-random-string       ← you choose this
```

---

### 4 — Push to GitHub

```bash
git init
git add .
git commit -m "init prizepicks-edge"
```

Go to github.com → New repository → name it `prizepicks-edge` → copy the remote URL:

```bash
git remote add origin https://github.com/YOUR_USERNAME/prizepicks-edge.git
git push -u origin main
```

---

### 5 — Deploy to Vercel (free)

1. Go to https://vercel.com → sign up with GitHub
2. Click Add New Project → import `prizepicks-edge`
3. Click Deploy — live in ~30 seconds at https://prizepicks-edge.vercel.app

---

### 6 — Create a KV store (caches picks between requests)

1. Vercel dashboard → Storage tab
2. Create Database → KV → name it `prizepicks-kv` → Create
3. Connect Project → select `prizepicks-edge`
4. Vercel auto-injects KV_REST_API_URL and KV_REST_API_TOKEN ✅

---

### 7 — Set environment variables on Vercel

Vercel dashboard → your project → Settings → Environment Variables:

| Name                | Value                              |
|---------------------|------------------------------------|
| ANTHROPIC_API_KEY   | your key from console.anthropic.com|
| CRON_SECRET         | same string as in your .env        |
| MAX_PICKS           | 16                                 |

KV vars are auto-added — you don't need to add them manually.

---

### 8 — Redeploy & test

1. Vercel dashboard → Deployments → three dots → Redeploy
2. Visit your live URL
3. Click Refresh Picks → enter your CRON_SECRET → wait ~60s
4. Picks appear with full AI reasoning!

---

## Share with friends

Just send your Vercel URL. Anyone can view picks — only people with your CRON_SECRET can trigger a refresh.

---

## Auto-refresh

The cron in vercel.json fires at 9am, 1pm, and 6pm PT daily.

NOTE: Vercel crons require the Pro plan ($20/mo). On the free Hobby plan,
use https://cron-job.org — create a free job POSTing to:
  https://your-site.vercel.app/api/cron?secret=YOUR_CRON_SECRET

---

## Project structure

```
prizepicks-edge/
│
├── api/
│   ├── _scraper.js    # Hits api.prizepicks.com — gets live props
│   ├── _analyzer.js   # Sends props to Claude AI with web search
│   ├── _kv.js         # Vercel KV cache wrapper
│   ├── picks.js       # GET  /api/picks
│   ├── refresh.js     # POST /api/refresh (needs CRON_SECRET)
│   ├── cron.js        # GET  /api/cron (Vercel auto-trigger)
│   └── status.js      # GET  /api/status
│
├── public/
│   └── index.html     # Full dashboard (no build step needed)
│
├── .env.example       # Rename to .env and fill in
├── vercel.json        # Routes + cron schedule
├── package.json
└── prizepicks-edge.code-workspace   # Open this in VSCode
```

---

## Disclaimer

For entertainment and research only. Verify lines on the official PrizePicks app. Never bet more than you can afford to lose.
