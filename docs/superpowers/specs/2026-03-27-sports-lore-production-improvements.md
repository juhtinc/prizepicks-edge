# Sports Lore — Production Pipeline Improvements Spec
> Date: 2026-03-27

---

## Overview

14 improvements to the Sports Lore automated YouTube Shorts pipeline, organized by priority. Each spec includes the n8n node changes, data schema updates, and implementation details.

---

## 1. Title, Description & Hook Generation

**Problem:** Scripts are generated but titles/descriptions/hashtags are not automated. Title is ~50% of Shorts CTR.

**Implementation:** Add a new Claude node after script generation in `weekly-batch`.

### New Node — `Generate Metadata via Claude`
**Type:** Claude API (HTTP Request)
**Position:** After script generation, before clip-sourcer
**Prompt:**
```
You are a viral YouTube Shorts title expert for sports history content.

Given this script about {{ playerName }} ({{ storyType }}):
{{ scriptText }}

Generate:
1. title_a: A curiosity-gap hook title (5-8 words, makes viewer NEED to know). Example: "The NBA Banned Him For Being Too Good"
2. title_b: A bold claim title (5-8 words). Example: "Nobody Remembers The Best Shooter Ever"
3. description: 2-3 sentences with keywords for YouTube SEO (include player name, team, era)
4. hashtags: 7 hashtags, mix of broad (#shorts #nba #basketball) and specific (#playername)
5. hook_line: The FIRST sentence of the script, rewritten to be maximum scroll-stopping. This is what the viewer hears in the first 2 seconds. Must be a surprising fact, bold claim, or provocative question.

Return JSON only:
{"title_a":"...","title_b":"...","description":"...","hashtags":["..."],"hook_line":"..."}
```

**Max tokens:** 500
**Model:** claude-sonnet-4-5

### Script Queue Schema Additions:
| Column | Type | Description |
|--------|------|-------------|
| Title A | string | Primary title option |
| Title B | string | A/B test title option |
| Description | string | YouTube description with SEO keywords |
| Hashtags | string | Comma-separated hashtags |
| Hook Line | string | Optimized first 2 seconds of voiceover |

### Changes to `video-production`:
- Use `Hook Line` as the first line of the ElevenLabs voiceover input (replace original first sentence)
- Set YouTube upload title to `Title A` (or use YouTube's A/B feature if available via API)
- Set YouTube description and tags from generated metadata

---

## 2. Thumbnail Auto-Generation

**Problem:** YouTube Shorts now display thumbnails in subscription feeds and desktop. No thumbnail = lower CTR.

**Implementation:** Add a Creatomate render job specifically for thumbnails after script generation.

### New Node — `Generate Thumbnail via Creatomate`
**Type:** HTTP Request to Creatomate API
**Template Design:** 1080x1920 (vertical) with:
- Large player photo (sourced from ESPN/Google Images in clip-sourcer)
- Bold text overlay: Player name + 2-3 word hook
- Gradient background matching Sports Lore brand colors
- Small Sports Lore watermark

**Creatomate Template Elements:**
```json
{
  "template_id": "YOUR_THUMBNAIL_TEMPLATE_ID",
  "modifications": {
    "player_name": "{{ playerName }}",
    "hook_text": "{{ hookLine | truncate: 30 }}",
    "player_image": "{{ playerPhotoUrl }}",
    "accent_color": "{{ brandColor }}"
  }
}
```

### Script Queue Schema Addition:
| Column | Type |
|--------|------|
| Thumbnail URL | string |
| Player Photo URL | string |

### Changes to `video-production`:
- After YouTube upload, set custom thumbnail via YouTube Data API `thumbnails.set` endpoint
- Fallback: if thumbnail generation fails, YouTube auto-selects a frame (current behavior)

---

## 3. Clip Quality Feedback Loop

**Problem:** Bad clips get deleted manually but the system never learns why.

**Implementation:** Add a rejection tracking column and feed it back to clip-sourcer's Claude prompt.

### Script Queue Schema Additions:
| Column | Type | Description |
|--------|------|-------------|
| Clips Rejected | number | Count of manually deleted clips |
| Rejection Reasons | string | JSON array: `["wrong_player", "low_res", "irrelevant"]` |

### Changes to `clip-sourcer`:
Add a **pre-search node** that reads the last 4 weeks of rejection data:
```javascript
// Read last 4 weeks of Script Queue rows
const recentRows = items.filter(r => r['Clips Rejected'] > 0);
const patterns = {};
recentRows.forEach(r => {
  const reasons = JSON.parse(r['Rejection Reasons'] || '[]');
  reasons.forEach(reason => {
    patterns[reason] = (patterns[reason] || 0) + 1;
  });
});
// Feed into Claude prompt: "Common clip issues: wrong_player (12x), low_res (5x)"
```

Append to clip-sourcer's Claude search term prompt:
```
AVOID these common issues from past weeks:
{{ rejectionPatterns }}
Specifically: {{ topRejectionReason }} has been the #1 issue.
Prioritize clips that clearly show the player's face and jersey number.
```

### New Workflow — `log-clip-rejection`
**Trigger:** Manual webhook (link in each clip preview email)
**Purpose:** When you delete a clip from Drive, click a rejection link to log why
**Email addition:** Each clip preview email gets rejection buttons:
```
Clip 1: [✓ Keep] [✗ Wrong Player] [✗ Low Quality] [✗ Irrelevant]
```
These are webhook links that update the Script Queue row.

---

## 4. Opt-Out Confirmation Model (Flip the Default)

**Problem:** You confirm every week even when clips are fine. This is unnecessary friction.

**Implementation:** Replace "click to start" with "click to PAUSE."

### Changes to `weekly-batch` confirmation email:

**Old flow:** Clips ready → you review → click confirm → production starts
**New flow:** Clips ready → production auto-starts Monday 6AM → you click PAUSE only if something is wrong

**New email subject:** `[Sports Lore] Week of {{ date }} — 7 videos queued (auto-starts Mon 6AM)`

**New email body:**
```
This week's videos are queued and will auto-start Monday 6 AM.

REVIEW IF NEEDED:
- Check clip previews in Drive
- Everything looks good? Do nothing. Production starts automatically.
- Something wrong? Click pause below.

⏸ PAUSE PRODUCTION (stops auto-start, you'll need to manually confirm later):
https://n8n.yourdomain.com/webhook/pause-batch?batchId={{ batchId }}&token={{ token }}
```

### New Webhook — `pause-batch`
**Purpose:** Sets a `Paused` flag on the batch. Monday 6AM schedule trigger checks this flag before auto-starting.

**Node 1:** Webhook (GET, path: `pause-batch`)
**Node 2:** Validate token
**Node 3:** Google Sheets — Update all 7 rows: set `Status` → `Paused`
**Node 4:** Send confirmation email: "Batch paused. Click resume when ready: [resume link]"

### Changes to Monday 6AM Schedule Trigger:
```javascript
// Check if batch is paused
const rows = items.filter(r => r['Status'] === 'Pending');
const pausedRows = items.filter(r => r['Status'] === 'Paused');

if (pausedRows.length > 0) {
  // Don't auto-start — send reminder email instead
  return [{ json: { action: 'remind', batchId } }];
}
// Proceed with auto-start
return [{ json: { action: 'start', batchId } }];
```

---

## 5. Parallel Clip Sourcing

**Problem:** 7 sequential clip-sourcer runs = 21-35 minutes. Blocking.

**Implementation:** Use n8n's SplitInBatches with batch size 7.

### Changes to `weekly-batch`:
Replace the sequential loop with:

**Node: `Split Scripts into Parallel Batches`**
**Type:** SplitInBatches
**Batch Size:** 7 (all at once)

Each batch item feeds into:
**Node: `Execute clip-sourcer`**
**Type:** Execute Workflow
**Wait for Completion:** Yes

**Result:** All 7 clip-sourcer runs execute simultaneously. Total time: ~3-5 min instead of 21-35 min.

**Caution:** Check API rate limits:
- Pexels: 200 req/hour (OK for 7 parallel, ~28 requests each)
- YouTube Data API: 10,000 units/day (OK)
- Google Drive: 1,000 req/100sec (OK)

---

## 6. Analytics Feedback Loop

**Problem:** Story selection doesn't learn from what performs well.

**Implementation:** Weekly analytics pull → feed into next week's story selection prompt.

### New Workflow — `analytics-feedback`
**Trigger:** Schedule, Sunday 8 PM (1 hour before weekly-batch)
**Purpose:** Pull last week's YouTube analytics and store a performance summary.

**Node 1 — `Pull YouTube Analytics`**
**Type:** HTTP Request to YouTube Analytics API
**Endpoint:** `https://youtubeanalytics.googleapis.com/v2/reports`
**Parameters:**
```
metrics: views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained
dimensions: video
filters: video=={{ last7VideoIds }}
startDate: {{ 7daysAgo }}
endDate: {{ today }}
```

**Node 2 — `Analyze Performance by Story Type`**
**Type:** Code
```javascript
const videos = $input.all();
const byType = {};

videos.forEach(v => {
  const type = v.json.storyType; // from Published Log cross-reference
  if (!byType[type]) byType[type] = { views: 0, retention: 0, subs: 0, count: 0 };
  byType[type].views += v.json.views;
  byType[type].retention += v.json.averageViewPercentage;
  byType[type].subs += v.json.subscribersGained;
  byType[type].count++;
});

// Calculate averages
Object.keys(byType).forEach(type => {
  byType[type].avgViews = Math.round(byType[type].views / byType[type].count);
  byType[type].avgRetention = (byType[type].retention / byType[type].count).toFixed(1);
});

return [{ json: { byType, weekOf: new Date().toISOString() } }];
```

**Node 3 — `Save to Analytics Log`**
**Type:** Google Sheets — Append Row
**Sheet:** Analytics Log (new tab)

### Changes to `weekly-batch` Claude prompt:
Add performance context:
```
PERFORMANCE DATA FROM LAST 4 WEEKS:
{{ analyticsContext }}

Story types ranked by average views:
1. forgotten_legend: 45K avg views, 62% retention
2. what_if: 38K avg views, 58% retention
3. trending_callback: 22K avg views, 45% retention

Select 7 stories for this week. Weight toward higher-performing story types
but include at least 1 experimental type to test new formats.
```

### Analytics Log Schema:
| Column | Type |
|--------|------|
| Week Of | date |
| Story Type | string |
| Avg Views | number |
| Avg Retention % | number |
| Avg Subs Gained | number |
| Video Count | number |

---

## 7. Hook Optimization (Mandatory First 3 Seconds)

**Problem:** First 3 seconds determine 80% of Shorts retention. Currently no dedicated hook optimization.

**Implementation:** Dedicated Claude node that ONLY optimizes the hook, separate from script generation.

### New Node — `Optimize Hook` (in weekly-batch, after script generation)
**Type:** Claude API
**Prompt:**
```
You are a YouTube Shorts retention expert. The first 3 seconds determine whether someone keeps watching.

Here is a script for a sports history Short about {{ playerName }}:
{{ fullScript }}

Rewrite ONLY the first 1-2 sentences (the hook). The rest stays exactly the same.

Requirements for the hook:
- Must create immediate curiosity (viewer NEEDS to know what happens next)
- Use one of these proven patterns:
  a) Shocking stat: "This man averaged 40 points and nobody remembers him"
  b) Bold claim: "The NBA literally changed its rules because of one player"
  c) Direct challenge: "You've never heard of the greatest passer in NBA history"
  d) Time pressure: "In 1986, one game changed basketball forever"
- Maximum 15 words
- No clickbait that the video doesn't deliver on
- The hook must connect to the actual story

Return JSON:
{"hook":"...","pattern_used":"shocking_stat|bold_claim|direct_challenge|time_pressure","original_first_line":"..."}
```

### Changes to Script Queue:
- `Hook Line` column stores the optimized hook
- `Hook Pattern` column stores which pattern was used (for A/B analysis later)

### Changes to `video-production`:
- ElevenLabs voiceover input: replace first sentence with `Hook Line`
- First 2 seconds of video should have NO background music (just voice) — add a 2-second silent intro in Creatomate template

---

## 8. A/B Testing on Titles

**Problem:** One title per video. No data on what works.

**Implementation:** Generate 2 titles and use YouTube's built-in A/B test feature (or manual rotation).

### Already handled by Feature #1:
`title_a` and `title_b` are generated in the metadata node.

### YouTube Upload Changes:
**Option A (if YouTube API supports it):**
Use the YouTube Data API `videos.update` to set both titles. YouTube will automatically test them.

**Option B (manual rotation):**
```javascript
// Alternate between title_a and title_b based on day of week
const useB = new Date().getDay() % 2 === 0;
const title = useB ? scriptRow['Title B'] : scriptRow['Title A'];
```

### Tracking:
Add to Published Log:
| Column | Type |
|--------|------|
| Title Used | string |
| Title Version | A or B |
| Views at 48h | number |
| CTR at 48h | number |

After 4 weeks, analyze which title style wins more often → feed back into title generation prompt.

---

## 9. Post Time Optimization

**Problem:** All videos post at 7 PM EST regardless of sport or content.

**Implementation:** Sport-based posting schedule with override capability.

### Posting Schedule Lookup:
```javascript
const POST_TIMES = {
  // Sport → optimal post time (EST)
  'NBA': '18:00',      // 6 PM — pre-game buzz
  'MLB': '15:00',      // 3 PM — afternoon games
  'NFL': '11:00',      // 11 AM — Sunday morning
  'NHL': '17:00',      // 5 PM — pre-game
  'Soccer': '12:00',   // Noon — international audience
  'Boxing': '20:00',   // 8 PM — fight night energy
  'default': '19:00',  // 7 PM — general sports
};
```

### Changes to `video-production`:
**Node modification — YouTube Upload:**
Replace hardcoded `publishAt: "19:00"` with:
```javascript
const sport = scriptRow['Story Type'].includes('nba') ? 'NBA'
  : scriptRow['Story Type'].includes('mlb') ? 'MLB'
  : scriptRow['Player Sport'] || 'default';
const postTime = POST_TIMES[sport] || POST_TIMES['default'];
```

### Script Queue Schema Addition:
| Column | Type | Description |
|--------|------|-------------|
| Player Sport | string | Primary sport of the player |
| Scheduled Post Time | string | Calculated optimal time |

---

## 10. Cross-Posting to TikTok & Instagram Reels

**Problem:** YouTube-only distribution. TikTok and Reels are free additional audiences.

**Implementation:** After YouTube upload, push to TikTok and Instagram via their APIs.

### New Nodes (added to end of `video-production`):

**Node — `Remove YouTube Watermark`**
**Type:** Code (FFmpeg)
```javascript
// Re-render from Creatomate without YouTube watermark
// Or use the original Creatomate output (which doesn't have one)
const videoUrl = creatomateOutput.url; // Already watermark-free
```

**Node — `Upload to TikTok`**
**Type:** HTTP Request
**API:** TikTok Content Posting API v2
**Endpoint:** `https://open.tiktokapis.com/v2/post/publish/video/init/`
**Headers:** Bearer token from TikTok developer account
**Body:**
```json
{
  "post_info": {
    "title": "{{ title }}",
    "description": "{{ description }} {{ tiktokHashtags }}",
    "disable_duet": false,
    "disable_comment": false,
    "disable_stitch": false
  },
  "source_info": {
    "source": "FILE_UPLOAD",
    "video_url": "{{ videoUrl }}"
  }
}
```

**Node — `Upload to Instagram Reels`**
**Type:** HTTP Request
**API:** Instagram Graph API
**Two-step process:**
1. Create media container:
```
POST https://graph.facebook.com/v19.0/{{ igUserId }}/media
?media_type=REELS
&video_url={{ videoUrl }}
&caption={{ description }} {{ igHashtags }}
```
2. Publish:
```
POST https://graph.facebook.com/v19.0/{{ igUserId }}/media_publish
?creation_id={{ containerId }}
```

### Platform-Specific Hashtags:
```javascript
const platformHashtags = {
  youtube: '#shorts #nba #basketball #sportshistory',
  tiktok: '#fyp #foryou #nba #basketball #sportsfact #didyouknow',
  instagram: '#reels #nba #basketball #sportshistory #explore',
};
```

### Published Log Additions:
| Column | Type |
|--------|------|
| TikTok URL | string |
| TikTok Views 48h | number |
| Instagram URL | string |
| Instagram Views 48h | number |

### Prerequisites:
- TikTok Developer Account (apply at developers.tiktok.com)
- Instagram Business Account connected to Facebook Page
- Meta Developer App with Instagram Content Publishing permission

---

## 11. Comment Monitoring & Auto-Reply

**Problem:** Replying to comments in the first hour significantly boosts algorithm performance. Currently manual.

**Implementation:** Hourly workflow that flags high-engagement comments.

### New Workflow — `comment-monitor`
**Trigger:** Schedule, every 1 hour (first 24h after upload only)

**Node 1 — `Get Recent Videos`**
**Type:** Google Sheets — Read Published Log
**Filter:** Videos uploaded in last 24 hours

**Node 2 — `Fetch Comments per Video`**
**Type:** HTTP Request (loop)
**API:** YouTube Data API `commentThreads.list`
```
GET https://www.googleapis.com/youtube/v3/commentThreads
?part=snippet
&videoId={{ videoId }}
&maxResults=20
&order=relevance
```

**Node 3 — `Score Comments`**
**Type:** Code
```javascript
const comments = $input.all();
const scored = comments.map(c => {
  const text = c.json.snippet.topLevelComment.snippet.textDisplay;
  const likes = c.json.snippet.topLevelComment.snippet.likeCount;

  // Score: engagement + question detection + sentiment
  let score = likes * 2;
  if (text.includes('?')) score += 5; // Questions = engagement opportunity
  if (text.length > 50) score += 3;  // Longer comments = more invested
  if (/who|what|when|why|how/i.test(text)) score += 3; // Genuine questions

  return { ...c.json, score, text, likes };
}).sort((a, b) => b.score - a.score);

return scored.slice(0, 5).map(s => ({ json: s })); // Top 5 comments
```

**Node 4 — `Generate Reply Suggestions`**
**Type:** Claude API
**Prompt:**
```
You manage a YouTube Shorts channel about sports history. Here are the top comments on today's video about {{ playerName }}:

{{ comments }}

For each comment, suggest a short, authentic reply (1-2 sentences). Be:
- Conversational, not corporate
- Add a fun fact when relevant
- Ask a follow-up question to keep the thread going
- Never be defensive

Return JSON array:
[{"comment_id":"...","suggested_reply":"..."}]
```

**Node 5 — `Send Comment Digest Email`**
**Type:** Gmail
**Subject:** `[Sports Lore] 💬 {{ commentCount }} comments to reply to`
**Body:**
```
Today's video "{{ title }}" has {{ commentCount }} comments worth replying to.

{{ for each comment }}
💬 {{ comment.text }} ({{ comment.likes }} likes)
   Suggested reply: {{ suggestedReply }}
   [Reply on YouTube →]({{ commentUrl }})
{{ end }}
```

### Optional Auto-Reply (Phase 2):
Once you trust the suggested replies, add a node that auto-posts them via YouTube API `comments.insert`. Start with manual approval (email), graduate to auto after 2 weeks of good suggestions.

---

## 12. Underperformer Re-Upload Strategy

**Problem:** Some Shorts flop. Re-uploads with different titles often outperform originals.

**Implementation:** 48-hour performance check → auto-queue re-upload for underperformers.

### New Workflow — `performance-check`
**Trigger:** Schedule, daily at 10 AM

**Node 1 — `Read Videos from 48h Ago`**
**Type:** Google Sheets — Read Published Log
**Filter:** `Upload Date` = 2 days ago

**Node 2 — `Pull 48h Stats`**
**Type:** YouTube Analytics API
**Metrics:** views, averageViewPercentage, subscribersGained

**Node 3 — `Evaluate Performance`**
**Type:** Code
```javascript
const video = $input.first().json;
const views = video.views;
const retention = video.averageViewPercentage;
const avgViews = video.channelAvgViews; // from Analytics Log

// Underperformer: <40% of channel average views
const isUnderperformer = views < avgViews * 0.4;
// Low retention: <30% average view duration
const lowRetention = retention < 30;

if (isUnderperformer) {
  return [{
    json: {
      action: 're-upload',
      videoId: video.videoId,
      reason: lowRetention ? 'bad_hook' : 'bad_title',
      originalTitle: video.title,
      originalViews: views,
    }
  }];
}
return [{ json: { action: 'none' } }];
```

**Node 4 — `Generate New Title + Hook`**
**Type:** Claude API (only runs if action = 're-upload')
**Prompt:**
```
This YouTube Short about {{ playerName }} underperformed ({{ views }} views, {{ retention }}% retention).

Original title: "{{ originalTitle }}"
Original hook: "{{ originalHook }}"

The issue is likely: {{ reason === 'bad_hook' ? 'viewers leave in first 3 seconds — the hook is weak' : 'the title doesn't compel clicks' }}

Generate a completely different approach:
{"new_title":"...","new_hook":"...","change_rationale":"..."}
```

**Node 5 — `Queue Re-Upload`**
**Type:** Google Sheets — Append to Re-Upload Queue
Schedule the re-upload for next week (different day than original).

### Re-Upload Queue Schema:
| Column | Type |
|--------|------|
| Original Video ID | string |
| Original Title | string |
| Original Views 48h | number |
| New Title | string |
| New Hook | string |
| Scheduled Re-Upload Date | date |
| Status | Pending / Uploaded / Skipped |

---

## 13. Creatomate Fallback (FFmpeg)

**Problem:** If Creatomate goes down, entire week stalls.

**Implementation:** Lightweight FFmpeg fallback that renders a basic version.

### New Node — `IF: Creatomate Available?`
**Type:** IF
**Check:** HTTP HEAD request to Creatomate API. If status ≠ 200, use fallback.

### Fallback Node — `Render via FFmpeg`
**Type:** Code (requires FFmpeg on server)
```javascript
const { execSync } = require('child_process');

// Simple compositing: background image + voiceover audio + text overlay
const cmd = `ffmpeg -loop 1 -i "${playerImage}" -i "${voiceoverAudio}" \
  -vf "drawtext=text='${hookLine}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=h-200" \
  -c:v libx264 -tune stillimage -c:a aac -b:a 192k \
  -shortest -pix_fmt yuv420p "${outputPath}"`;

execSync(cmd);
```

**Quality:** Much lower than Creatomate (no fancy transitions, no clip montage — just a static image with voiceover and text). But it maintains the "never miss a day" consistency.

### Decision Logic:
1. Try Creatomate (normal path)
2. If Creatomate fails → retry once after 5 min
3. If still fails → FFmpeg fallback
4. Send warning email: "⚠️ Used fallback render for {{ playerName }} — Creatomate was down"

---

## 14. Script Queue Schema (Complete)

All original columns plus new additions from features above:

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| Row ID | string | weekly-batch | `2026-W14-1` |
| Scheduled Date | date | weekly-batch | Publish date |
| Player Name | string | weekly-batch | Player the script covers |
| Player Sport | string | weekly-batch | NBA, MLB, NHL, etc. |
| Story Type | string | weekly-batch | `forgotten_legend`, `trending_callback`, etc. |
| Script | string | weekly-batch | Full script text |
| Hook Line | string | hook-optimizer | Optimized first 2 seconds |
| Hook Pattern | string | hook-optimizer | `shocking_stat`, `bold_claim`, etc. |
| Title A | string | metadata-gen | Primary title |
| Title B | string | metadata-gen | A/B test title |
| Title Used | string | video-production | Which title was used |
| Description | string | metadata-gen | YouTube description |
| Hashtags | string | metadata-gen | Comma-separated |
| Search Terms | string | weekly-batch | Legacy clip search terms |
| Clip Briefs | JSON | clip-sourcer | 4 clip briefs |
| Status | string | various | `Pending` → `Ready` → `Produced` → `Paused` |
| Clips Sourced | number | clip-sourcer | 0 or 4 |
| Clips Rejected | number | manual | Count of deleted clips |
| Rejection Reasons | JSON | manual webhook | `["wrong_player"]` |
| Clip Source Status | string | clip-sourcer | `Pending` / `Auto-sourced` / `Manual` |
| Date Sourced | date | clip-sourcer | When clips uploaded |
| Batch ID | string | weekly-batch | `2026-W14` |
| Player Photo URL | string | clip-sourcer | For thumbnail generation |
| Thumbnail URL | string | thumbnail-gen | Generated thumbnail |
| Scheduled Post Time | string | computed | Sport-based optimal time |
| YouTube URL | string | video-production | After upload |
| YouTube Video ID | string | video-production | For analytics |
| TikTok URL | string | cross-poster | After TikTok upload |
| Instagram URL | string | cross-poster | After Reels upload |
| Views at 48h | number | performance-check | For re-upload decision |
| Retention at 48h | number | performance-check | Average view % |

---

## Implementation Order

| Phase | Features | Est. Time | Impact |
|-------|----------|-----------|--------|
| **1** | #1 Title/Hook Gen, #7 Hook Optimization, #5 Parallel Sourcing | 3-4 hours | Highest — directly improves views |
| **2** | #4 Opt-Out Confirmation, #9 Post Time Optimization | 1-2 hours | Saves weekly time + better timing |
| **3** | #6 Analytics Feedback, #8 A/B Testing | 2-3 hours | Compounds over time |
| **4** | #2 Thumbnails, #12 Re-Upload Strategy | 2-3 hours | Recovers underperformers |
| **5** | #10 Cross-Posting, #11 Comment Monitoring | 3-4 hours | Distribution + engagement |
| **6** | #3 Clip Quality Feedback, #13 FFmpeg Fallback, #14 Schema | 2-3 hours | Polish + reliability |

**Total estimated build time:** 14-19 hours across 6 phases.

---

## Credential Requirements

| Service | Already Have? | Needed For |
|---------|--------------|------------|
| YouTube Data API | ✅ | Analytics, comments, upload |
| YouTube Analytics API | ❓ Enable | Performance tracking |
| TikTok Content Posting API | ❌ Apply | Cross-posting |
| Instagram Graph API | ❌ Apply | Cross-posting to Reels |
| Creatomate | ✅ | Thumbnails (new template) |
| Claude API | ✅ | Hooks, titles, comment replies |
| Gmail | ✅ | Notifications |
| Google Sheets | ✅ | All data storage |
