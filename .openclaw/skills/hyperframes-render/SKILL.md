## hyperframes-render

### Overview
Renders MP4 videos via the HyperFrames render service deployed on Vercel.
Supports three render paths: pre-built compositions, named templates with params,
and custom VideoSpec JSON. Jobs are async — submit, poll or receive callback,
get back an MP4 URL.

### When to use this skill
Trigger phrases:
- "render a video", "make a video", "produce an MP4"
- "create a listing video for [product]"
- "make a YouTube intro for [episode]"
- "generate a price drop video for [item]"
- "render the [composition] composition"
- Any request involving video generation for jewelry listings, YouTube intros,
  product promotions, or social media clips

### Environment setup
The following environment variables must be set in the agent's shell or
OpenClaw config:
```
HYPERFRAMES_URL   — base URL of the HyperFrames Vercel deployment
RENDER_API_KEY    — Bearer token for API authentication
```

### Instructions

#### Path 1: Pre-built composition (fastest)
Submit a named composition that already exists on the server.
Use for: compositions listed in `GET /api/compositions`.

```bash
curl -s -X POST "${HYPERFRAMES_URL}/api/jobs" \
  -H "Authorization: Bearer ${RENDER_API_KEY}" \
  -H "Content-Type: application/json" \
  --max-time 15 \
  --retry 3 --retry-delay 5 \
  -d '{
    "composition": "vercel-intro",
    "agentId": "openclaw",
    "callbackUrl": "https://n8n.trapmoney.dpdns.org/webhook/video-done",
    "meta": { "source": "openclaw-skill" }
  }'
```

Response: `202 { "jobId": "uuid", "pollUrl": "/api/jobs/uuid", "status": "queued" }`

#### Path 2: Template render (fastest for known formats)
Use a named template with your own content params. Three templates available:
`jewelry-reveal`, `youtube-intro`, `price-drop`.

```bash
curl -s -X POST "${HYPERFRAMES_URL}/api/render-template" \
  -H "Authorization: Bearer ${RENDER_API_KEY}" \
  -H "Content-Type: application/json" \
  --max-time 15 \
  --retry 3 --retry-delay 5 \
  -d '{
    "template": "jewelry-reveal",
    "params": {
      "compositionId": "ring-14k-gold-001",
      "title": "14k Gold Ring",
      "price": "$349",
      "subtitle": "Estate Collection",
      "productImageUrl": "https://res.cloudinary.com/example/ring.jpg",
      "accentColor": "#c9a84c",
      "bgColor": "#0a0a0f",
      "durationSecs": 10
    },
    "agentId": "openclaw",
    "callbackUrl": "https://n8n.trapmoney.dpdns.org/webhook/video-done",
    "meta": { "source": "openclaw-skill" }
  }'
```

#### Path 3: Custom VideoSpec (full creative control)
Submit a declarative VideoSpec JSON describing clips, text, images, audio.

```bash
curl -s -X POST "${HYPERFRAMES_URL}/api/generate" \
  -H "Authorization: Bearer ${RENDER_API_KEY}" \
  -H "Content-Type: application/json" \
  --max-time 15 \
  --retry 3 --retry-delay 5 \
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
        },
        {
          "type": "image",
          "id": "logo",
          "src": "https://example.com/logo.png",
          "start": 0,
          "duration": 15,
          "track": 1,
          "style": "top:20px; right:20px; width:120px;"
        }
      ]
    },
    "agentId": "openclaw",
    "callbackUrl": "https://n8n.trapmoney.dpdns.org/webhook/video-done",
    "meta": { "source": "openclaw-skill" }
  }'
```

### Polling loop
Use this shell one-liner to poll a job until finished (max 5 minutes):

```bash
JOB_ID="<uuid-from-submit>"; \
START=$(date +%s); \
TIMEOUT=300; \
while true; do \
  RESULT=$(curl -s "${HYPERFRAMES_URL}/api/jobs/${JOB_ID}"); \
  FINISHED=$(echo "${RESULT}" | jq -r '.finished'); \
  STATUS=$(echo "${RESULT}" | jq -r '.status'); \
  if [ "${FINISHED}" = "true" ]; then \
    echo "${RESULT}" | jq '{status, url, error, durationMs}'; \
    break; \
  fi; \
  NOW=$(date +%s); \
  ELAPSED=$((NOW - START)); \
  if [ "${ELAPSED}" -ge "${TIMEOUT}" ]; then \
    echo "{\"error\":\"timeout\",\"jobId\":\"${JOB_ID}\"}"; \
    break; \
  fi; \
  echo "[${ELAPSED}s] status=${STATUS} — still rendering..." >&2; \
  sleep 10; \
  done
```

The polling loop checks every 10 seconds. On `finished: true` it prints the
result with url (on success) or error (on failure). On timeout after 5 minutes
it prints an error JSON.

### Response handling
- **status "done"**: Extract `.url` for the MP4 download link. The URL is a
  Vercel Blob URL. It is publicly accessible for ~24 hours.
- **status "failed"**: Extract `.error` for the failure message.
  Do NOT retry automatically — log the error for human review.

### Error handling
- HTTP **429** (rate limit): Check `.resetAt` field. Wait until that time
  before retrying. The daily limit is 20 renders by default.
- HTTP **4xx** (bad request): Fix the submitted payload. Never retry as-is.
- HTTP **5xx** (server error): Retry after 30 seconds, max 3 attempts.
- **Job timeout** (>5 minutes): Mark as failed in your task log.
  Do not submit a duplicate job — the original may still be running.
- **Network errors**: curl's `--retry 3 --retry-delay 5` handles transient
  failures automatically.

### Checking limits before submitting
Always check spend before submitting batches:

```bash
curl -s "${HYPERFRAMES_URL}/api/status" | jq '{spend, queue}'
```

If `spend.rendersToday >= spend.dailyLimit`, wait until `spend.resetAt` (UTC
midnight) before submitting more.

### Listing available compositions
```bash
curl -s "${HYPERFRAMES_URL}/api/compositions" | jq '.compositions'
```

### Listing recent jobs
```bash
curl -s "${HYPERFRAMES_URL}/api/jobs?limit=10" | jq '.jobs[] | {id: .id[0:8], status, composition, agentId}'
```

### Examples

#### Example 1: Render a jewelry reveal video for a 14k gold ring at $349
```bash
curl -s -X POST "${HYPERFRAMES_URL}/api/render-template" \
  -H "Authorization: Bearer ${RENDER_API_KEY}" \
  -H "Content-Type: application/json" \
  --max-time 15 \
  --retry 3 --retry-delay 5 \
  -d '{
    "template": "jewelry-reveal",
    "params": {
      "compositionId": "ring-14k-gold-001",
      "title": "14k Gold Ring",
      "price": "$349",
      "subtitle": "Estate Collection — One of a Kind",
      "productImageUrl": "https://res.cloudinary.com/example/ring.jpg",
      "accentColor": "#c9a84c"
    },
    "agentId": "openclaw",
    "callbackUrl": "https://n8n.trapmoney.dpdns.org/webhook/video-done"
  }'
```

#### Example 2: Create a YouTube intro for episode 12 of CreationcompanionDIY
```bash
curl -s -X POST "${HYPERFRAMES_URL}/api/render-template" \
  -H "Authorization: Bearer ${RENDER_API_KEY}" \
  -H "Content-Type: application/json" \
  --max-time 15 \
  --retry 3 --retry-delay 5 \
  -d '{
    "template": "youtube-intro",
    "params": {
      "compositionId": "yt-intro-ep12",
      "channelName": "@CreationcompanionDIY",
      "episodeTitle": "DIY Jewelry Cleaner That Actually Works",
      "accentColor": "#6c63ff"
    },
    "agentId": "openclaw",
    "callbackUrl": "https://n8n.trapmoney.dpdns.org/webhook/video-done"
  }'
```

#### Example 3: Render the vercel-intro composition (pre-built)
```bash
JOB_RESP=$(curl -s -X POST "${HYPERFRAMES_URL}/api/jobs" \
  -H "Authorization: Bearer ${RENDER_API_KEY}" \
  -H "Content-Type: application/json" \
  --max-time 15 \
  --retry 3 --retry-delay 5 \
  -d '{"composition":"vercel-intro","agentId":"openclaw"}')

JOB_ID=$(echo "${JOB_RESP}" | jq -r '.jobId')
echo "Submitted job: ${JOB_ID}" >&2

# Poll for completion
START=$(date +%s)
TIMEOUT=300
while true; do
  RESULT=$(curl -s "${HYPERFRAMES_URL}/api/jobs/${JOB_ID}")
  FINISHED=$(echo "${RESULT}" | jq -r '.finished')
  if [ "${FINISHED}" = "true" ]; then
    echo "Result:"
    echo "${RESULT}" | jq '{status, url: .url[0:80], durationMs}'
    break
  fi
  ELAPSED=$(( $(date +%s) - START ))
  if [ "${ELAPSED}" -ge "${TIMEOUT}" ]; then
    echo "{\"error\":\"timeout\",\"jobId\":\"${JOB_ID}\"}"
    break
  fi
  sleep 10
done
```
