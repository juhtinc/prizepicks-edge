# GitHub Actions Clip Pipeline — Design Spec

**Date:** 2026-04-01
**Goal:** Source real NBA highlight footage via GitHub Actions (yt-dlp + FFmpeg), store in Cloudflare R2, and use in Creatomate video compositions.

## Problem

The video pipeline uses generic Pexels stock footage (guy dribbling in a gym) for all NBA history videos. This kills credibility. The clip-sourcer code exists but can't run on Vercel (no yt-dlp/FFmpeg). Need an external runner.

## Architecture

```
Vercel (weekly-batch.js, clips phase)
  └── POST github.com/repos/juhtinc/prizepicks-edge/dispatches
        event_type: "source-clips"
        payload: { batchId, rowIds: [...] }

GitHub Actions Runner (Ubuntu, ~20 min)
  ├── Install yt-dlp + FFmpeg (cached)
  ├── For each rowId:
  │   ├── Read script from Vercel KV
  │   ├── Claude plans clip slots (Anthropic API)
  │   ├── yt-dlp downloads 2-4s segments from YouTube highlights
  │   ├── FFmpeg transforms (crop, color grade, mirror, speed, vignette, grain)
  │   ├── Upload transformed clips to Cloudflare R2
  │   └── Save clipBriefs + playerPhotoUrl back to Vercel KV
  └── POST callback to Vercel (batch status = "Review")
```

## Files

| File | Action | Purpose |
|------|--------|---------|
| `.github/workflows/clip-pipeline.yml` | Create | GitHub Actions workflow definition |
| `scripts/process-clips.js` | Create | Standalone Node script that runs in the workflow |
| `lib/lore/weekly-batch.js` | Modify | Clips phase triggers GitHub dispatch instead of direct call |
| `lib/lore/lib/clip-transformer.js` | Modify | `uploadTransformedClips()` uploads to R2 via S3 API |

## Workflow: `.github/workflows/clip-pipeline.yml`

**Trigger:** `repository_dispatch` with `event_type: "source-clips"`

**Steps:**
1. Checkout repo
2. Setup Node.js 20
3. Install FFmpeg (cached via `FedericoCarboni/setup-ffmpeg@v3`)
4. Install yt-dlp via pip (cached)
5. `npm ci` (install deps)
6. Run `node scripts/process-clips.js` with payload from dispatch event

**Secrets needed in GitHub repo settings:**
- `ANTHROPIC_API_KEY`
- `YOUTUBE_API_KEY`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `CRON_SECRET`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`

**Timeout:** 30 minutes (handles 7 scripts × ~3 min each with buffer)

## Script: `scripts/process-clips.js`

Reads the dispatch payload, iterates over rowIds, and for each:

1. **Read script from KV** — gets playerName, storyType, script text, template segments
2. **Claude clip planning** — asks Claude what clips to show at each timestamp (reuses existing `askClaudeJSON` prompt from clip-sourcer.js)
3. **YouTube search** — finds 3 highlight compilations via YouTube Data API
4. **Smart clip selection** — uses FFmpeg scene detection to find actual play boundaries instead of blind interval sampling
5. **Download segments** — yt-dlp extracts 2.5s clips at detected scene boundaries
6. **Transform** — FFmpeg applies: crop to vertical, color grade (mood-based), mirror (50% chance), speed shift (93-107%), vignette, Ken Burns zoom. Settings: `-c:v libx264 -preset medium -crf 18 -r 30 -an -pix_fmt yuv420p -movflags +faststart`
7. **Upload to R2** — S3-compatible PUT via `@aws-sdk/client-s3`. Public URL: `https://{bucket}.r2.dev/{rowId}/{slot}.mp4`
8. **Get player photo** — Wikipedia/ESPN fallback chain (reuses existing `getPlayerImage`)
9. **Save to KV** — writes `clipBriefs[]` and `playerPhotoUrl` to the script row

**Error handling:**
- If yt-dlp fails for a clip, skip that slot (Pexels fallback in composer)
- If R2 upload fails, retry once, then skip
- Log all results, post summary as workflow annotation

## Clip-transformer.js Changes

Replace placeholder `uploadTransformedClips()` with R2 upload:

```javascript
async function uploadToR2(filePath, key) {
  const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
  const fs = require("fs");
  
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  
  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: fs.readFileSync(filePath),
    ContentType: "video/mp4",
  }));
  
  return `https://${process.env.R2_BUCKET_NAME}.r2.dev/${key}`;
}
```

## Weekly-batch.js Changes

Clips phase sends GitHub dispatch instead of calling clip-sourcer:

```javascript
if (phase === "clips") {
  const axios = require("axios");
  await axios.post(
    `https://api.github.com/repos/juhtinc/prizepicks-edge/dispatches`,
    {
      event_type: "source-clips",
      client_payload: { batchId, rowIds: batch.rowIds },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_PAT}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );
  batch.status = "Sourcing Clips";
  await saveBatch(batchId, batch);
}
```

**New secret needed:** `GITHUB_PAT` — Personal Access Token with `repo` scope to trigger workflow dispatches.

## FFmpeg Improvements

- CRF: 23 → 18 (higher quality, YouTube re-encodes anyway)
- Preset: fast → medium (better quality for same CRF)
- Add `-r 30` to normalize framerate
- Default clip duration: 3s → 2.5s (stronger fair use)
- Scene detection before extraction (find actual play boundaries)

## Source Channel Safety

- Blocklist NBA official + ESPN channels (higher DMCA risk)
- Prefer fan-compiled highlight compilations
- Never source >3 clips from same YouTube video
- Rotate source videos across the batch

## Cloudflare R2 Setup (user must do manually)

1. Create Cloudflare account at cloudflare.com
2. Enable R2 in dashboard
3. Create bucket named `sports-lore-clips`
4. Enable public access on the bucket (Settings > Public access > Allow)
5. Create API token: R2 > Manage R2 API Tokens > Create token
6. Copy: Account ID, Access Key ID, Secret Access Key
7. Add all as GitHub repo secrets

## Free Tier Budget

- GitHub Actions: ~170 min/month (7 scripts × 3 min × 4 weeks = 84 min)
- Cloudflare R2: ~2GB/month (12 clips × 2MB × 14 videos × 4 weeks = 1.3GB)
- YouTube Data API: 10,000 units/day (search = 100 units, ~3 searches per script)
- All well within free limits

## Not In Scope

- TikTok/Instagram clip formatting (same clips, Creatomate handles aspect ratio)
- Audio from source clips (stripped by FFmpeg `-an`)
- Clip quality scoring / auto-rejection (future iteration)
- NBA API as alternative source (future iteration)
