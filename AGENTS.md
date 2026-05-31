# HyperFrames Render Service — Agent API Contract

**Repo:** `Bzcasper/hyperframes-player-src` (private fork of `heygen-com/hyperframes-vercel-template`)
**Stack:** Next.js 15, Postgres (Neon), Vercel Blob, Vercel Sandbox
**Purpose:** Async video rendering service. Agents POST specs → get `jobId` (202) → poll until `finished === true` → download MP4 from `url`.

---

## Authentication

Bearer token via `RENDER_API_KEY` env var. Uses `timingSafeEqual` from `node:crypto`.

```
Authorization: Bearer <RENDER_API_KEY>
```

If `RENDER_API_KEY` is unset, **all routes are open** (dev mode).

**Routes requiring auth:** `POST /api/jobs`, `POST /api/generate`, `POST /api/render-template`, `DELETE /api/jobs/[jobId]`, `POST /api/render-generated`

---

## Endpoints

### `GET /api/status`

Health check. No auth. Returns spend, queue breakdown, endpoint catalog, available templates.

#### Response 200

```json
{
  "status": "ok",
  "version": "1.0.0",
  "spend": {
    "rendersToday": 3,
    "dailyLimit": 20,
    "resetAt": "2026-05-31T00:00:00.000Z"
  },
  "queue": {
    "total": 12,
    "queued": 0,
    "rendering": 1,
    "done": 10,
    "failed": 1
  },
  "endpoints": [
    "POST /api/jobs",
    "POST /api/generate",
    "POST /api/render-template",
    "GET  /api/jobs",
    "GET  /api/jobs/:jobId",
    "GET  /api/compositions",
    "GET  /api/status"
  ],
  "templates": ["jewelry-reveal", "youtube-intro", "price-drop"]
}
```

---

### `POST /api/jobs`

Submit a pre-bundled composition by name. Auth required. Check `GET /api/compositions` for available names.

#### Request

```json
{
  "composition": "vercel-intro",
  "callbackUrl": "https://n8n.example.com/webhook/video-done",
  "agentId": "hermes",
  "meta": { "task": "promo-video" }
}
```

#### Response 202

```json
{
  "jobId": "a1b2c3d4-...",
  "status": "queued",
  "pollUrl": "/api/jobs/a1b2c3d4-...",
  "composition": "vercel-intro",
  "createdAt": "2026-05-30T12:00:00.000Z"
}
```

#### Errors

| Status | Meaning |
|--------|---------|
| 400 | Missing `composition`, invalid `callbackUrl` |
| 401 | Missing/invalid Bearer token |
| 429 | Daily render limit exceeded (see `resetAt`) |

---

### `GET /api/jobs`

List recent jobs. No auth required.

#### Query Params

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int | 20 | 1–100 |
| `agentId` | string | — | Filter by agent identifier |

#### Response 200

```json
{
  "jobs": [ /* RenderJob[] */ ],
  "total": 5
}
```

---

### `GET /api/jobs/[jobId]`

Poll a single job. No auth required. Append `finished` boolean field.

#### Response 200 (pending)

```json
{
  "id": "a1b2c3d4-...",
  "status": "rendering",
  "finished": false,
  "composition": "vercel-intro",
  "url": null,
  "error": null
}
```

#### Response 200 (done)

```json
{
  "id": "a1b2c3d4-...",
  "status": "done",
  "finished": true,
  "url": "https://blob.vercel-storage.com/renders/...mp4",
  "durationMs": 45230,
  "error": null
}
```

#### Response 200 (failed)

```json
{
  "id": "a1b2c3d4-...",
  "status": "failed",
  "finished": true,
  "error": "Render failed with status 500",
  "url": null
}
```

#### Response 404

```json
{ "error": "Job not found" }
```

---

### `DELETE /api/jobs/[jobId]`

Delete a job. Auth required.

#### Response 200

```json
{ "deleted": true }
```

#### Response 404

```json
{ "error": "Job not found" }
```

---

### `POST /api/generate`

Submit a declarative `VideoSpec` (dynamic composition, no pre-authored HTML). Auth required.

#### Request Body

```json
{
  "spec": {
    "compositionId": "product-promo-001",
    "width": 1920,
    "height": 1080,
    "totalDuration": 15,
    "backgroundColor": "#0a0a0f",
    "clips": [
      {
        "type": "video",
        "id": "bg",
        "src": "https://cdn.example.com/bg.mp4",
        "start": 0,
        "track": 0,
        "volume": 0
      },
      {
        "type": "text",
        "id": "headline",
        "content": "New Product Drop",
        "start": 1,
        "duration": 8,
        "track": 2,
        "style": "top:40%; left:50%; transform:translateX(-50%); color:#fff; font-size:96px; font-weight:900;",
        "animation": { "entrance": "fade-up", "exit": "fade-out" }
      },
      {
        "type": "image",
        "id": "logo",
        "src": "https://cdn.example.com/logo.png",
        "start": 0,
        "duration": 15,
        "track": 1,
        "style": "top:20px; right:20px; width:120px;"
      },
      {
        "type": "audio",
        "id": "music",
        "src": "https://cdn.example.com/track.mp3",
        "start": 0,
        "track": 3,
        "volume": 0.4
      }
    ]
  },
  "callbackUrl": "https://n8n.example.com/webhook/video-done",
  "agentId": "hermes",
  "meta": { "source": "ebay-scout" }
}
```

#### ClipSpec Types

##### `type: "video"`
```ts
{
  type: "video";
  id: string;           // unique across all clips
  src: string;          // public URL
  start: number;        // seconds from 0
  duration?: number;    // optional, defaults to totalDuration
  track: number;        // z-order / parallel track
  volume?: number;      // 0-1
  mediaStart?: number;  // offset into source
}
```

##### `type: "image"`
```ts
{
  type: "image";
  id: string;
  src: string;
  start: number;
  duration: number;     // required for images
  track: number;
  style?: string;       // CSS applied to <img>
}
```

##### `type: "audio"`
```ts
{
  type: "audio";
  id: string;
  src: string;
  start: number;
  duration?: number;
  track: number;
  volume?: number;
}
```

##### `type: "text"`
```ts
{
  type: "text";
  id: string;
  content: string;      // HTML-escaped automatically
  start: number;
  duration: number;     // required for text
  track: number;
  style?: string;       // CSS (position, font, color, etc.)
  animation?: {
    entrance?: "fade-up" | "fade-in" | "slide-left" | "slide-right" | "scale-up";
    exit?: "fade-out" | "slide-left" | "slide-right" | "fade-down";
    entranceDuration?: number;  // default 0.4s
    exitDuration?: number;      // default 0.3s
  };
}
```

#### Validation Rules

| Rule | Error |
|------|-------|
| `compositionId` must match `/^[a-z0-9-]+$/` | TypeError |
| All clip `id` values must be unique | `duplicate clip id` |
| No two clips on same `track` may overlap in time | `clips overlap on track N` |
| `text` and `image` clips require `duration` | `must have a duration` |
| `width`, `height`, `totalDuration` must be positive ints | TypeError |
| `width`, `height` must be integers | TypeError |

#### Response 202

```json
{
  "jobId": "a1b2c3d4-...",
  "status": "queued",
  "pollUrl": "/api/jobs/a1b2c3d4-...",
  "composition": "product-promo-001",
  "createdAt": "2026-05-30T12:00:00.000Z"
}
```

---

### `POST /api/render-template`

Submit a named template with params. Fastest path from intent to MP4. Auth required.

#### Request

```json
{
  "template": "jewelry-reveal",
  "params": {
    "compositionId": "bracelet-001",
    "productImageUrl": "https://res.cloudinary.com/...",
    "title": "Tennis Bracelet",
    "subtitle": "Estate Collection",
    "price": "$89",
    "accentColor": "#c9a84c",
    "bgColor": "#0a0a0f",
    "durationSecs": 10
  },
  "callbackUrl": "https://n8n.example.com/webhook/video-done",
  "agentId": "hermes"
}
```

#### Response 202

```json
{
  "jobId": "a1b2c3d4-...",
  "status": "queued",
  "pollUrl": "/api/jobs/a1b2c3d4-...",
  "composition": "bracelet-001",
  "template": "jewelry-reveal",
  "createdAt": "2026-05-30T12:00:00.000Z",
  "width": 1080,
  "height": 1080
}
```

---

### `GET /api/compositions`

List available pre-bundled composition directory names.

#### Response 200

```json
{
  "compositions": ["glow-card", "vercel-intro"]
}
```

---

### `GET /api/migrate`

Run database migrations (idempotent — uses `CREATE TABLE IF NOT EXISTS`).

#### Response 200

```json
{ "ok": true, "migrated": true }
```

---

## Templates Reference

### `jewelry-reveal`

1080×1080, 10s default. Gold theme (`#c9a84c` accent).

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `compositionId` | string | yes | — | Slug, e.g. `ring-14k-gold-001` |
| `productImageUrl` | string | yes | — | Public image URL (Cloudinary, etc.) |
| `title` | string | yes | — | Product name (64px, white, bold) |
| `subtitle` | string | no | — | Collection name (32px, accent color) |
| `price` | string | no | — | e.g. `"$349"` (48px button on accent bg) |
| `accentColor` | string | no | `#c9a84c` | CSS color |
| `bgColor` | string | no | `#0a0a0f` | CSS color |
| `durationSecs` | number | no | 10 | Total duration |

**Clips:** track 0 = product image (full-bleed, 85% opacity), track 1 = title (fade-up entrance, 1s→8s), track 2 = subtitle (fade-in, 1.4s→7.5s), track 3 = price badge (scale-up, 2s→7.5s)

---

### `youtube-intro`

1920×1080, 8s default. Purple theme (`#6c63ff` accent).

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `compositionId` | string | yes | — | Slug |
| `channelName` | string | yes | — | e.g. `@CreationcompanionDIY` |
| `episodeTitle` | string | yes | — | 80px white headline |
| `bgVideoUrl` | string | no | — | Optional background video (muted) |
| `accentColor` | string | no | `#6c63ff` | CSS color |
| `bgColor` | string | no | `#0a0a0f` | CSS color |
| `durationSecs` | number | no | 8 | Total duration |

**Clips:** track 0 = bg video (optional, volume 0), track 1 = channel name (slide-right, 0.5s→7s, 56px uppercase accent), track 2 = episode title (fade-up entrance, fade-out exit, 1.2s→6s, 80px white)

---

### `price-drop`

1080×1080, 8s default. Red theme (`#ff4f6d` accent).

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `compositionId` | string | yes | — | Slug |
| `productName` | string | yes | — | 56px white headline |
| `originalPrice` | string | yes | — | e.g. `"$120"` (64px, strike-through, gray) |
| `salePrice` | string | yes | — | e.g. `"$79"` (120px, accent, bold, scale-up) |
| `productImageUrl` | string | no | — | Background image (40% opacity) |
| `badgeText` | string | no | — | e.g. `"34% OFF"` (pill badge, accent bg) |
| `accentColor` | string | no | `#ff4f6d` | CSS color |
| `bgColor` | string | no | `#0a0a0f` | CSS color |
| `durationSecs` | number | no | 8 | Total duration |

---

## Job Object (`RenderJob`)

```ts
{
  id: string,                    // UUID v4
  composition: string,           // Composition slug / compositionId
  endpoint: "jobs" | "generate", // Source endpoint
  status: "queued" | "restoring" | "rendering" | "encoding" | "uploading" | "done" | "failed",
  createdAt: string,             // ISO 8601
  startedAt: string | null,      // ISO 8601
  completedAt: string | null,    // ISO 8601
  durationMs: number | null,     // Wall-clock render time
  url: string | null,            // Public Vercel Blob MP4 URL (set on "done")
  error: string | null,          // Failure message (set on "failed")
  callbackUrl: string | null,    // Webhook URL from submission
  agentId: string | null,        // Agent identifier
  meta: Record<string, string>   // Arbitrary key-value tags
}
```

---

## Webhook Callbacks

If `callbackUrl` is provided at submission, fires a `POST` to that URL on completion/failure.

### Headers

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `X-HyperFrames-Event` | `render.complete` or `render.failed` |
| `X-HyperFrames-Job-Id` | `{job.id}` |

### Body

Full `RenderJob` object (same shape as poll response).

---

## Render Pipeline

```
POST /api/jobs (or /api/generate or /api/render-template)
  │
  ▼
202 { jobId, status: "queued" }
  │
  ▼ (detached)
updateJob → "restoring"
  │  Restore/create Vercel Sandbox (with snapshot cache)
  ▼
updateJob → "rendering"
  │  Call /api/render (pre-bundled) or /api/render-generated (dynamic)
  │  Sandbox runs: npx hyperframes render → out.mp4
  ▼
updateJob → "encoding" (implicit inside sandbox)
  │
  ▼
updateJob → "uploading" (implicit inside sandbox)
  │
  ▼
Upload MP4 to Vercel Blob via @vercel/blob
  │
  ▼
updateJob → "done" (with url)
  │
  ▼ (optional)
POST callbackUrl with X-HyperFrames-Event: render.complete
```

On any failure: `updateJob → "failed"` with `error` message, fires `render.failed` callback.

---

## Studio GUI

Browser-based UI at `/`. Uses `POST /api/generate` under the hood. Features:
- Form: prompt, style preset (cinematic/minimal/vibrant/corporate), duration, format (16:9/9:16/1:1), animation intensity, subtitles toggle
- Pipeline progress indicator (6 stages: validating → building → restoring → rendering → encoding → uploading)
- Job history sidebar (polls `GET /api/jobs`)
- `<hyperframes-player>` custom element for live preview

---

## Postgres Schema

### `hf_jobs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT PRIMARY KEY` | UUID |
| `composition` | `TEXT NOT NULL` | Composition slug |
| `endpoint` | `TEXT NOT NULL` | `'jobs'` or `'generate'` |
| `status` | `TEXT NOT NULL` | `'queued'` (default) |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `DEFAULT NOW()` |
| `started_at` | `TIMESTAMPTZ` | Null until render starts |
| `completed_at` | `TIMESTAMPTZ` | Set on done/failed |
| `duration_ms` | `INTEGER` | Wall-clock time |
| `url` | `TEXT` | Public MP4 URL |
| `error` | `TEXT` | Failure message |
| `callback_url` | `TEXT` | Webhook destination |
| `agent_id` | `TEXT` | Agent identifier |
| `meta` | `JSONB` | `DEFAULT '{}'::jsonb` |

Index: `idx_hf_jobs_status_created` on `(status, created_at)`

### `hf_spend`

| Column | Type | Notes |
|--------|------|-------|
| `date_key` | `TEXT PRIMARY KEY` | UTC date string (`YYYY-MM-DD`) |
| `count` | `INTEGER NOT NULL` | `DEFAULT 0` |
| `window_start` | `TIMESTAMPTZ NOT NULL` | `DEFAULT NOW()` |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RENDER_API_KEY` | dev-optional | Bearer token for auth; unset = dev mode (all open) |
| `POSTGRES_URL` (or `DATABASE_URL`) | yes | Neon Postgres connection string |
| `MAX_RENDERS_PER_DAY` | no | Daily render limit (default `20`) |
| `BLOB_READ_WRITE_TOKEN` | yes | Vercel Blob token for MP4 storage |
| `VERCEL_OIDC_TOKEN` | for internal render | Auto-injected by Vercel, passed to /api/render |
| `VERCEL_URL` | for internal render | Auto-injected by Vercel, self-call origin |

---

## Agent Workflow (Reference)

### Polling (Hermes skill, OpenClaw skill)

1. `GET /api/status` — confirm service health, check remaining budget
2. `GET /api/compositions` — list available pre-bundled compositions (skip if using `/api/generate` or `/api/render-template`)
3. `POST /api/render-template` (or `/api/jobs` or `/api/generate`) — receive `jobId`
4. Poll `GET /api/jobs/<jobId>` every 5–10s until `finished === true`
5. If `status === "done"` → `url` field has the MP4
6. If `status === "failed"` → `error` field has the message

### Webhook (n8n)

1. `POST /api/render-template` with `callbackUrl` pointing to n8n webhook
2. n8n receives `POST` with `X-HyperFrames-Event: render.complete` header + full `RenderJob` body
3. n8n extracts `url` and continues downstream workflow

---

## Compositions (Bundled)

### `glow-card/`

- **Duration:** ~57s
- **Content:** Music video with rap lyrics, glitch transitions, 3D rotation effects
- **Directory:** `public/compositions/glow-card/`

### `vercel-intro/`

- **Duration:** ~11s
- **Content:** Animated intro using Three.js (WebGL shader), GSAP, and Anime.js
- **Directory:** `public/compositions/vercel-intro/`

---

## Rate Limiting

Daily render limit tracked via `hf_spend` table (persistent across cold starts). Configurable:
- **Default:** 20 renders/day
- **Env var:** `MAX_RENDERS_PER_DAY`
- **Resets:** UTC midnight
- **On exceeded:** `POST` endpoints return `429 { error, resetAt, limit }`
- **Check remaining:** `GET /api/status` → `spend.rendersToday` / `spend.dailyLimit`

---

## Typical Errors

| Code | Body | Cause |
|------|------|-------|
| 400 | `{ "error": "composition is required" }` | Missing `composition` field |
| 400 | `{ "error": "callbackUrl must be a valid URL" }` | Invalid URL string |
| 400 | `{ "error": "template must be one of: ..." }` | Unknown template name |
| 400 | `{ "error": "Invalid spec", "details": "..." }` | VideoSpec validation failure |
| 401 | `{ "error": "Unauthorized" }` | Missing/invalid Bearer token |
| 404 | `{ "error": "Job not found" }` | Unknown job ID |
| 429 | `{ "error": "Daily render limit reached. Set MAX_RENDERS_PER_DAY env var to adjust.", "resetAt": "...", "limit": 20 }` | Spend limit hit |
| 500 | `{ "error": "..." }` | Internal render/sandbox failure |
