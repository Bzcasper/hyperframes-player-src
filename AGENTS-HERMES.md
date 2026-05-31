# HyperFrames Render Service — Agent Briefing

**Deployment:** Vercel (Next.js 15, Postgres/Neon, Vercel Blob)
**Repo:** github.com/Bzcasper/hyperframes-player-src
**Purpose:** Async video rendering microservice. Agents POST specs → get `jobId` (202) → poll or callback → MP4 URL.

---

## Base URL

```
HYPERFRAMES_URL=https://hyperframes-player-src.vercel.app
```

Set this as an environment variable in the agent's shell or OpenClaw config.

---

## Authentication

All `POST` requests require:

```
Authorization: Bearer $RENDER_API_KEY
```

The `RENDER_API_KEY` is a shared secret between Vercel and agents. Set it in both places. If unset on the server, all routes are open (dev mode).

**Authenticated routes:** `POST /api/jobs`, `POST /api/generate`, `POST /api/render-template`, `DELETE /api/jobs/[jobId]`

**Public routes:** `GET /api/jobs`, `GET /api/jobs/[jobId]`, `GET /api/compositions`, `GET /api/status`

---

## The Three Render Paths

### Path 1: Pre-built Composition (fastest)

Submit a composition that already exists on the server. Check `GET /api/compositions` for available names.

```bash
curl -s -X POST $HYPERFRAMES_URL/api/jobs \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "composition": "vercel-intro",
    "agentId": "hermes",
    "callbackUrl": "https://n8n.trapmoney.dpdns.org/webhook/video-done"
  }'
```

### Path 2: Template Render (fastest for known use cases)

Named templates with your own content. Three templates: `jewelry-reveal`, `youtube-intro`, `price-drop`.

```bash
curl -s -X POST $HYPERFRAMES_URL/api/render-template \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "template": "jewelry-reveal",
    "params": {
      "compositionId": "ring-14k-gold-001",
      "title": "14k Gold Ring",
      "price": "$349",
      "subtitle": "Estate Collection",
      "productImageUrl": "https://res.cloudinary.com/example/ring.jpg"
    },
    "agentId": "hermes",
    "callbackUrl": "https://n8n.trapmoney.dpdns.org/webhook/video-done"
  }'
```

### Path 3: Custom VideoSpec (full creative control)

Submit a declarative VideoSpec JSON describing clips, text, images, audio.

```bash
curl -s -X POST $HYPERFRAMES_URL/api/generate \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "spec": {
      "compositionId": "custom-promo-001",
      "width": 1920,
      "height": 1080,
      "totalDuration": 15,
      "backgroundColor": "#0a0a0f",
      "clips": [
        {
          "type": "text",
          "id": "headline",
          "content": "New Collection",
          "start": 1,
          "duration": 8,
          "track": 2,
          "style": "top:40%; left:50%; color:#fff; font-size:96px; font-weight:900;"
        }
      ]
    },
    "agentId": "hermes",
    "callbackUrl": "https://n8n.trapmoney.dpdns.org/webhook/video-done"
  }'
```

---

## Polling Pattern

Poll every 10 seconds until `finished === true`. Timeout after 5 minutes.

```bash
JOB_ID="<uuid-from-submit>"
TIMEOUT=300
START=$(date +%s)

while true; do
  RESULT=$(curl -s $HYPERFRAMES_URL/api/jobs/$JOB_ID)
  FINISHED=$(echo "$RESULT" | jq -r '.finished')

  if [ "$FINISHED" = "true" ]; then
    echo "$RESULT" | jq '{status, url, error, durationMs}'
    break
  fi

  ELAPSED=$(( $(date +%s) - START ))
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "{\"error\":\"timeout\",\"jobId\":\"$JOB_ID\"}"
    break
  fi

  sleep 10
done
```

---

## Callback Pattern (preferred)

Instead of polling, add `callbackUrl` to any POST body. The n8n workflow at `https://n8n.trapmoney.dpdns.org/webhook/video-done` receives the completion event and routes it to downstream systems (Hermes notification, YouTube upload, etc.).

This is preferred over polling because:
- No wasted API calls while the job is queued
- Instant notification on completion
- n8n handles retries and error routing

---

## Spend Limits

Check remaining budget before submitting batches:

```bash
curl -s $HYPERFRAMES_URL/api/status | jq '{spend, queue}'
```

- **Default limit:** 20 renders/day
- **Resets:** UTC midnight
- **On exceeded:** POST returns `429 { error, resetAt, limit }`
- **Configurable:** `MAX_RENDERS_PER_DAY` env var on Vercel

---

## Templates Reference

### `jewelry-reveal`
- **Format:** 1080×1080 square, 10s default
- **Required params:** `compositionId`, `title`, `productImageUrl`
- **Optional params:** `subtitle`, `price`, `accentColor` (default `#c9a84c`), `bgColor` (default `#0a0a0f`), `durationSecs` (default 10)

### `youtube-intro`
- **Format:** 1920×1080, 8s default
- **Required params:** `compositionId`, `channelName`, `episodeTitle`
- **Optional params:** `bgVideoUrl`, `accentColor` (default `#6c63ff`), `bgColor` (default `#0a0a0f`), `durationSecs` (default 8)

### `price-drop`
- **Format:** 1080×1080, 8s default
- **Required params:** `compositionId`, `productName`, `originalPrice`, `salePrice`
- **Optional params:** `productImageUrl`, `badgeText`, `accentColor` (default `#ff4f6d`), `bgColor` (default `#0a0a0f`), `durationSecs` (default 8)

---

## Error Handling Rules

| HTTP Status | Action |
|-------------|--------|
| 400 | Bad request — fix the payload, do not retry as-is |
| 401 | Check `RENDER_API_KEY` — fix and retry |
| 429 | Rate limited — wait until `resetAt` field before retrying |
| 5xx | Server error — retry after 30s, max 3 attempts |
| Job `failed` | Log the error message, do not retry automatically |
| Timeout (>300s) | Mark as timed-out, do not submit a duplicate |

---

## Webhook Callbacks from HyperFrames

When a render completes or fails, HyperFrames POSTs to your configured `callbackUrl`:

**Headers:**
- `X-HyperFrames-Event`: `render.complete` or `render.failed`
- `X-HyperFrames-Job-Id`: the job UUID

**Body:** Full `RenderJob` JSON object:
- `status`: "done" or "failed"
- `url`: MP4 URL (only on success)
- `error`: error message (only on failure)
- `durationMs`: render time in milliseconds
- `composition`, `agentId`, `meta`: same as submission

---

## Hermes Usage Pattern (Batch)

For batch rendering, use `scripts/hermes_render_batch.py`:

```bash
# Single job
python scripts/hermes_render_batch.py \
  --input /tmp/batch.json \
  --agent-id hermes \
  --output /tmp/results.json

# Validate without spending credits
python scripts/hermes_render_batch.py \
  --input /tmp/batch.json \
  --agent-id hermes \
  --dry-run

# Override callback URL
python scripts/hermes_render_batch.py \
  --input /tmp/batch.json \
  --callback https://n8n.trapmoney.dpdns.org/webhook/video-done
```

The batch script submits up to 5 jobs concurrently, polls every 10 seconds, and returns a structured JSON result with all job outcomes.

---

## OpenClaw Usage Pattern

Use the installed `hyperframes-render` skill. Trigger phrases:
- "render a video", "create a listing video", "make a YouTube intro"
- "produce an MP4", "generate a video for [product]"
- "make a price drop video for [item]"

The skill handles submission, polling, and error handling. Use the OpenClaw webhook at `http://localhost:18789/hooks/render-done` for callbacks.

---

## Environment Variables Reference

| Variable | Where | Description |
|----------|-------|-------------|
| `HYPERFRAMES_URL` | Agent shell | Base URL of the Vercel deployment |
| `RENDER_API_KEY` | Agent shell + Vercel | Bearer token for API auth |
| `OPENCLAW_HOOKS_TOKEN` | OpenClaw config | Token for OpenClaw webhook auth |
| `OPENCLAW_WEBHOOK_TOKEN` | Vercel env | Token for OpenClaw → HyperFrames webhook auth |
| `MAX_RENDERS_PER_DAY` | Vercel env | Daily render limit (default 20) |
