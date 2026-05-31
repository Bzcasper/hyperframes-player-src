# HyperFrames Player — Architecture & Design Decisions

> This is a heavily customized private fork of `heygen-com/hyperframes-vercel-template`.
> The original template was a vanilla Next.js scaffold with in-memory stores and demo
> render endpoints. This fork adds persistent Postgres storage, a 3-tier agent render
> API, Vercel Sandbox snapshot strategy, a Studio GUI with real-time pipeline
> visibility, and a template system for Hermes/OpenClaw agent integration.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Why Postgres Instead of In-Memory Stores](#2-why-postgres-instead-of-in-memory-stores)
3. [Why `pg` Not `@vercel/kv`](#3-why-pg-not-vercelkv)
4. [Render Entry Points](#4-render-entry-points)
5. [Sandbox Snapshot Strategy](#5-sandbox-snapshot-strategy)
6. [Preview System](#6-preview-system)
7. [Agent-Facing API](#7-agent-facing-api)
8. [Studio GUI](#8-studio-gui)
9. [Auth Pattern](#9-auth-pattern)
10. [Composition Builder](#10-composition-builder)
11. [Template System](#11-template-system)
12. [Detached Render Pattern](#12-detached-render-pattern)
13. [Database Schema](#13-database-schema)
14. [File Structure](#14-file-structure)
15. [Known Risks & Future Work](#15-known-risks--future-work)

---

## 1. System Overview

```
┌──────────────┐     ┌──────────────────────────────────────┐
│   Browser    │     │          Next.js 15 Server            │
│  (Studio GUI)│────▶│                                      │
│              │     │  ┌─────────┐  ┌──────────────────┐   │
│  <hyperframes│     │  │  page   │  │  API Routes       │   │
│   -player>   │◀────│  │  .tsx   │  │  ┌────────────┐   │   │
│   custom el  │     │  └─────────┘  │  │ /api/jobs   │   │   │
└──────────────┘     │               │  │ /api/generate│   │   │
                     │  ┌─────────┐  │  │ /api/render* │   │   │
┌──────────────┐     │  │  Preview │  │  │ /api/preview│   │   │
│   Hermes /   │────▶│  │  System  │  │  └────────────┘   │   │
│  OpenClaw    │     │  └─────────┘  └──────────────────┘   │
│   Agents     │◀────│                                      │
│              │     │  ┌──────────────────────────────────┐│
└──────────────┘     │  │       lib/                        ││
                     │  │  db.ts  job-store.ts  sandbox.ts  ││
                     │  │  composition-builder.ts templates ││
                     │  │  preview.ts  migrate.ts           ││
                     │  └──────────────────────────────────┘│
                     └──────┬───────────────────────────────┘
                            │
                    ┌───────▼────────────────┐
                    │   Vercel Sandbox         │
                    │   (Firecracker microVM)  │
                    │                          │
                    │  Chromium + `npx         │
                    │  hyperframes render`      │
                    │  + ffmpeg                │
                    │                          │
                    │  Snapshot restore: ~100ms│
                    │  Fresh provision: ~2 min │
                    └───────┬──────────────────┘
                            │
                    ┌───────▼──────────┐
                    │  Vercel Blob      │
                    │  (MP4 storage)    │
                    └──────────────────┘
```

### Key Numbers

| Metric | Value |
|--------|-------|
| Sandbox snapshot size | ~1.1 GB |
| Snapshot restore | ~100 ms |
| Fresh sandbox provision | ~2 min |
| Snapshot TTL | 7 days |
| Default daily render limit | 20 |
| Browser preview composition | `glow-card` (57s music video) |
| Template composition | `vercel-intro` (11s animated intro) |

---

## 2. Why Postgres Instead of In-Memory Stores

### The Problem

The original template used two in-memory stores:

```typescript
// Original (reset every cold start):
const jobs = new Map<string, RenderJob>();
const spendCounters = new Map<string, number>();
```

Every Vercel cold start — which happens frequently on the Hobby plan
(≈ 10 min inactivity) — wiped all pending jobs and spend counters. This meant:

- **Job polling returned 404.** Agents would submit a render job, get a `jobId`
  back, then poll `GET /api/jobs/<jobId>` and get "Job not found" because the
  serverless function had cold-started on a different instance.
- **Spend limits were meaningless.** The daily counter reset on every cold start,
  so an agent could blow through 100+ renders/day by timing requests to hit
  separate cold starts.
- **No post-render visibility.** Completed jobs vanished on redeploy, making
  debugging impossible.

### The Solution

Replaced both stores with Neon Postgres tables (`hf_jobs`, `hf_spend`). The
`pg` pool (`lib/db.ts`) uses a lazy singleton pattern:

```typescript
// lib/db.ts — lazy singleton pool
let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}
```

All CRUD functions are now `async`. The original synchronous `Map.get()` /
`Map.set()` calls became `await getJob(id)` / `await createJob(params)`.

### Trade-offs

- **+** Persistence across cold starts
- **+** Can inspect jobs from other tools (Supabase Studio, psql)
- **+** Spend guard is now atomic (Postgres upsert, not race-prone in-memory increment)
- **−** Adds ~5-10ms latency per operation (round-trip to Neon)
- **−** Introduces connection pool management; max 5 concurrent clients
- **−** Requires `POSTGRES_URL` env var; CI/CD must provision a database

---

## 3. Why `pg` Not `@vercel/kv`

### Decision

We use `pg` (node-postgres) directly, not `@vercel/kv`.

### Why

1. **KV is deprecated for this use case.** `@vercel/kv` wraps Redis (Upstash).
   Our data model is relational (jobs have structured fields, spend has a
   date-keyed counter). Postgres is a better fit.

2. **Neon Postgres was already provisioned.** The Vercel Marketplace auto-provisions
   a Neon Postgres instance when you enable storage. The `POSTGRES_URL` env var
   was already in `.env.local`. Using it cost $0 extra.

3. **`nodejs` runtime compatibility.** All render routes use
   `export const runtime = "nodejs"` (required by `@vercel/sandbox`). The `pg`
   package works natively with the Node.js runtime. KV would work too, but we'd
   still need a second database.

4. **Query flexibility.** Raw SQL lets us do indexed queries
   (`ORDER BY created_at DESC LIMIT $1`), composite filters, and JSONB metadata
   queries. KV would require multiple round-trips or a scan.

### What About Prisma / Drizzle?

Not chosen. The schema is trivially simple (2 tables, 1 index). An ORM would
add dependency weight, initialization latency, and another moving part. Raw
`pg` with typed helpers (`query<T>`, `queryOne<T>`, `execute`) is ~50 lines and
zero magic.

---

## 4. Render Entry Points

Three POST endpoints, each serving a different caller:

| Endpoint | Auth | Input | Caller |
|----------|------|-------|--------|
| `POST /api/render` | None (internal) | Pre-bundled composition from disk | `runRender()` (job runner) |
| `POST /api/render-generated` | `RENDER_API_KEY` | `{ compositionId, html }` | `runGeneratedRender()` / `runTemplateRender()` |
| `POST /api/render-job` | None | Multipart upload or `published_id` | Hermes/OpenClaw agents directly |

### `POST /api/render`

The simplest path. Reads composition files from `public/compositions/<name>/`
via `collectFiles()`, sends them to `renderInSandbox()`, uploads result MP4 to
Vercel Blob. No auth — it's an internal endpoint called by the job runner.

### `POST /api/render-generated`

Auth-protected. Accepts a dynamically built HTML string (not a file on disk)
and renders it in the sandbox. Used by `/api/generate` and `/api/render-template`
which build HTML from `VideoSpec` at request time.

### `POST /api/render-job`

Agent-facing. Two modes:

1. **published_id** — Fetches a live project from `https://hyperframes.dev/p/<id>`
   and renders the HTML. No file upload needed.
2. **Direct upload** — Accepts `multipart/form-data` with files array, detects
   audio files by key/name, and renders the composition.

Returns `{ success, url, filename, size, mode }`.

---

## 5. Sandbox Snapshot Strategy

### Motivation

Vercel Sandbox (Firecracker microVM) provisioning takes ~2 minutes: OS boot,
dnf install Chromium dependencies, npm install `hyperframes` + `ffmpeg-static`,
download Chrome Headless Shell. Adding this to every render would make the
service unusable.

### Solution

Build-time snapshot baked by `scripts/create-snapshot.ts`:

```
npm run build
  ├── next build             ← builds Next.js app
  └── tsx scripts/create-snapshot.ts   ← also part of "build" script
       ├── Create sandbox
       ├── dnf install (Chromium deps)
       ├── npm install (hyperframes, ffmpeg-static)
       ├── npx hyperframes browser ensure (Chrome Headless Shell)
       ├── sandbox.snapshot({ expiration: 7 days })
       └── upload pointer JSON: snapshot-cache/<deployment_id>.json → Blob
```

At render time, `lib/sandbox.ts:restoreOrCreate()`:

1. Reads snapshot pointer from Blob using `VERCEL_DEPLOYMENT_ID` and
   `BLOB_READ_WRITE_TOKEN`
2. Calls `Sandbox.create({ source: { type: "snapshot", snapshotId } })`
3. On failure: in dev, falls back to fresh provision; in production, throws

### Snapshot Anatomy (~1.1 GB)

```
/vercel/sandbox/
├── node_modules/
│   ├── @hyperframes/core/       ← hyperframes renderer
│   ├── ffmpeg-static/ffmpeg     ← linked to /usr/local/bin/ffmpeg
│   └── ffprobe-static/...       ← linked to /usr/local/bin/ffprobe
├── .cache/hyperframes/
│   └── chrome-headless-shell/   ← browser binary
└── ...dnf installed system libs (nss, alsa-lib, pango, etc.)
```

### Key Decisions

- **TTL = 7 days.** Vercel Sandbox snapshots auto-expire. 7 days is a pragmatic
  balance between rebuild cost and freshness. Redeploy triggers a fresh snapshot.
- **Pointer stored in Vercel Blob.** The `snapshot-cache/<deployment_id>.json`
  file maps deployment to snapshot. On redeploy, the old snapshot is orphaned
  (auto-expires), and the new build creates a fresh one.
- **Production fallback = throw.** If snapshot restore fails in production, we
  throw rather than silently provisioning fresh (which would timeout the render).
  This ensures the deployment is rolled back if the snapshot is broken.

---

## 6. Preview System

Two modes, both served by `lib/preview.ts`:

### Bundled Preview (`/api/preview`)

- Tries `scripts/bundle-preview.ts` (TSX bundler via `@hyperframes/core`'s
  `bundleToSingleHtml()`) for an inlined, self-contained HTML
- Falls back to raw `public/compositions/glow-card/index.html`
- Injects `<base href="/api/preview/">` and runtime script tag
- Caches the bundled output in memory (`bundledHtmlPromise`)

### Sub-Composition Preview (`/api/preview/comp/[...path]`)

- Reads a composition file (e.g., a `<template>`-based snippet)
- Extracts `<template>` inner content via regex
- Wraps in full HTML with `<head>` from the parent composition
- Rewrites relative URLs (`src`, `href`, `url()`) to be absolute under the
  preview base path
- Injects GSAP + runtime

### Path Traversal Protection

`resolvePreviewPath()` normalizes the path, rejects absolute paths and
`../` traversal, and verifies the resolved path stays under
`public/compositions/<current>/`.

```typescript
function resolvePreviewPath(path: string): string {
  const normalized = normalize(path).replaceAll("\\", "/");
  // Reject: empty, absolute, ".", "../"
  const abs = join(PREVIEW_COMPOSITION_DIR, normalized);
  // Verify: abs starts with PREVIEW_COMPOSITION_DIR
  if (!abs.startsWith(rootWithSep)) throw new Error("Invalid preview path");
  return abs;
}
```

### Runtime Serving

`/api/runtime.js` serves `@hyperframes/core`'s IIFE runtime from
`node_modules/`. Tries two possible paths (workspace vs. hoisted install).
Cached in memory after first load.

### `outputFileTracingIncludes`

Vercel's automatic file tracing doesn't capture composition assets or the
bundler's transitive dependencies. `next.config.mjs` explicitly includes:

- `public/compositions/**/*` for render + preview routes
- `scripts/bundle-preview.ts` and its transitive deps (esbuild, linkedom, tsx)
  for the preview bundler

---

## 7. Agent-Facing API

Three endpoints designed for Hermes/OpenClaw skill integration:

### `POST /api/jobs` — Fire a pre-authored composition

```json
{ "composition": "vercel-intro", "callbackUrl": "https://...", "agentId": "hermes" }
```
Fires `runRender()` which calls internal `/api/render`. Simplest path.

### `POST /api/generate` — Build and render from spec

```json
{ "spec": { "compositionId": "promo-001", "width": 1920, "height": 1080, ... } }
```
Validates with `validateVideoSpec()`, builds HTML via `buildCompositionHtml()`,
fires `runGeneratedRender()` which calls internal `/api/render-generated`.
Accepts `callbackUrl`, `meta`, `agentId`.

### `POST /api/render-template` — Template-based render

```json
{ "template": "jewelry-reveal", "params": { "title": "14k Ring", ... } }
```
Maps template name to factory function in `lib/templates.ts`, produces a
`VideoSpec`, then follows the same path as `/api/generate`.

### Common behavior

- All return `202 Accepted` with `{ jobId, pollUrl, status }`
- All enforce `RENDER_API_KEY` Bearer auth
- `POST /api/jobs` and `POST /api/generate` enforce daily spend guard
- All fire optional webhook callbacks on completion/failure

---

## 8. Studio GUI

React components in `components/studio/`. The main `page.tsx` orchestrates:

```
page.tsx
├── StudioForm         ← Prompt, style, duration, format, animation, subtitles
├── PipelineProgress   ← 6-stage lifecycle with elapsed timer
├── JobHistory         ← Auto-refreshing recent jobs list
└── <hyperframes-player>  ← Custom element for preview/result playback
```

### State Machine (`studio-reducer.ts`)

```
idle → generating (START)
         │ validating → building → restoring → rendering → encoding → uploading
         │                                            │
         ├── SUCCEED ──→ success (show MP4 link)
         └── FAIL ─────→ error (show message + retry)
                  │
                  └── RESET → idle
```

The 6 stages map to real backend states where possible:
- `validating` + `building` = client-side (form → spec → HTML)
- `restoring` → `rendering` → `encoding` → `uploading` = polled from job store

The `GENERATION_STAGES` array defines ordering. The reducer never moves
backwards (`latest-forward wins`) — this handles parallel simulated + real
progress updates.

### Auto-Polling

- `page.tsx` polls `GET /api/jobs/<jobId>` every 1500ms while generating
- `JobHistory` polls `GET /api/jobs?limit=10` every 3000ms if any job is not
  terminal

### Player

`<hyperframes-player>` is the custom element from `@hyperframes/player`.
It's dynamically imported in a `useEffect` (no SSR). The `src` switches
between `/api/preview` (idle state) and the rendered MP4 URL (success state).
The `key` prop forces re-mount when switching.

---

## 9. Auth Pattern

### The Problem

`isAuthorized()` is duplicated across **5 route files**:

- `/api/jobs/route.ts` (POST + DELETE)
- `/api/jobs/[jobId]/route.ts` (DELETE, not GET — GET is public for polling)
- `/api/generate/route.ts`
- `/api/render-generated/route.ts`
- `/api/render-template/route.ts`

### The Pattern

```typescript
function isAuthorized(req: NextRequest): boolean {
  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey) return true; // dev mode — no auth configured

  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return false;

  const token = header.slice("Bearer ".length);
  const tokenBuf = Buffer.from(token);
  const keyBuf = Buffer.from(apiKey);

  if (tokenBuf.length !== keyBuf.length) return false;
  return timingSafeEqual(tokenBuf, keyBuf);
}
```

### Why Not a Shared Module?

The function is small (12 lines). Extracting it to `lib/auth.ts` would save
repetition but add a file to import. It was left duplicated intentionally to
keep each route file self-contained and easy to read top-to-bottom.
This is acknowledged tech debt.

### Why `timingSafeEqual`?

Prevents timing attacks where an attacker measures response time to guess
the API key character-by-character. `timingSafeEqual` from `node:crypto`
always takes the same time regardless of how many characters match.

### Dev Mode

When `RENDER_API_KEY` is unset, `isAuthorized()` returns `true` for all
requests. This makes local development frictionless but means **never run
without `RENDER_API_KEY` in production**.

---

## 10. Composition Builder

`lib/composition-builder.ts` is pure TypeScript with zero dependencies.
It converts a declarative `VideoSpec` into a complete HyperFrames HTML string.

### VideoSpec Type

```typescript
type VideoSpec = {
  compositionId: string;    // /^[a-z0-9-]+$/
  width: number;
  height: number;
  totalDuration: number;
  backgroundColor?: string;
  clips: ClipSpec[];        // video | image | audio | text
  globalStyles?: string;
};
```

### Clip Types

| Type | Required Fields | Duration |
|------|----------------|----------|
| `video` | id, src, start, track | Optional (defaults to totalDuration) |
| `image` | id, src, start, duration, track | Required |
| `audio` | id, src, start, track | Optional |
| `text` | id, content, start, duration, track | Required |

### Text Animations

5 entrance types: `fade-up`, `fade-in`, `slide-left`, `slide-right`, `scale-up`
4 exit types: `fade-out`, `slide-left`, `slide-right`, `fade-down`

Each animation produces deterministic GSAP calls:

```typescript
tl.from("#headline", { opacity: 0, y: 40, duration: 0.4 }, 1.0);
```

The GSAP timeline is created as `paused: true` and registered on
`window.__timelines[compositionId]` so HyperFrames can seek it
deterministically during rendering.

### Validation (`validateVideoSpec` / `assertValid`)

- Structural validation: correct types, required fields
- No zod — manual structural checks (keeps bundle tiny and avoids cold-start
  import cost)
- compositionId must match `/^[a-z0-9-]+$/`
- All clip IDs must be unique
- No two clips on the same track may overlap in time
- text and image clips must have explicit duration

### HTML Output

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; overflow: hidden; }
    .clip { position: absolute; }
    [globalStyles]
  </style>
</head>
<body>
  <div id="stage" data-composition-id="..." data-start="0"
       data-width="1920" data-height="1080">
    <!-- clips rendered as <video>, <img>, <audio>, <div> with data-* attrs -->
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    // GSAP animation blocks
    tl.to({}, { duration: 15 }, 0);
    window.__timelines["promo-001"] = tl;
  </script>
</body>
</html>
```

---

## 11. Template System

`lib/templates.ts` provides three factory functions:

| Template | Use Case | Params | Duration |
|----------|----------|--------|----------|
| `jewelryRevealSpec` | Jewelry showcase (Hermes) | productImageUrl, title, subtitle, price | 10s |
| `youtubeIntroSpec` | Channel intro (OpenClaw) | channelName, episodeTitle, bgVideoUrl | 8s |
| `priceDropSpec` | Sale alert (Hermes scout) | productName, originalPrice, salePrice, badgeText | 8s |

Each returns a `VideoSpec` with:

- Themed colors (gold `#c9a84c`, purple `#6c63ff`, red `#ff4f6d`)
- Staggered text animations (entrance + exit)
- Track-based layout (image on track 0, text on tracks 1-N)
- Configurable duration, colors, content

### How Agents Use Templates

```bash
curl -X POST https://hyperframes.vercel.app/api/render-template \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "template": "jewelry-reveal",
    "params": {
      "compositionId": "ring-14k-001",
      "title": "14k Gold Diamond Ring",
      "productImageUrl": "https://res.cloudinary.com/...",
      "price": "$349",
      "subtitle": "Estate Collection"
    },
    "callbackUrl": "https://n8n.trapmoney.dpdns.org/webhook/video-done",
    "agentId": "hermes"
  }'
# → 202 { jobId: "uuid", pollUrl: "/api/jobs/uuid", ... }
```

---

## 12. Detached Render Pattern

### Why Detached?

Rendering in a Vercel Sandbox takes 30-120 seconds. Hanging an HTTP response
for that long would:

- Hit the 10s Hobby plan timeout
- Waste billable function duration while the client waits
- Break the agent pattern (agents want a quick 202, then poll/callback)

### How It Works

```
POST /api/generate
  │
  ├── 1. Check auth
  ├── 2. Validate spec
  ├── 3. Build HTML
  ├── 4. Create job (INSERT → hf_jobs, status="queued")
  ├── 5. void runGeneratedRender(jobId, spec, html)   ← DETACHED
  └── 6. Return 202 { jobId, pollUrl }
```

The `void` keyword fires the async function without awaiting it. Inside:

```
runGeneratedRender(jobId, spec, html):
  1. UPDATE job → status="restoring", startedAt=now
  2. FETCH POST /api/render-generated  ← internal loopback
  3. UPDATE job → status="rendering"
  4. (Sandbox renders...)
  5. UPDATE job → status="done", url=blobUrl
  6. IF callbackUrl: POST webhook with full RenderJob JSON
```

### What Can Go Wrong

- **Detached promise is unhandled.** If `runGeneratedRender()` hits an async
  error, it catches internally and writes to the job row. But if the synchronous
  setup before the first `await` throws, the error is silently lost.
- **Cold start kills the detached work.** If the serverless function terminates
  (e.g., 300s maxDuration, or a new deploy), the detached promise is garbage
  collected. The job stays in "restoring" or "rendering" forever.
  - Mitigation: `maxDuration = 300` (Vercel Pro). The render function is
    synchronous once the sandbox starts.
- **Loopback fetch requires the function to be reachable.** In production,
  `VERCEL_URL` provides the public URL. Locally, it defaults to
  `http://localhost:3000`.

### Job Lifecycle

```
queued → restoring → rendering → encoding → uploading → done
                                                       → failed
```

The 6 visible stages in the Studio GUI (`validating`, `building`, `restoring`,
`rendering`, `encoding`, `uploading`) map to backend states where possible.
`queued` → `building`, `restoring` → `restoring`, `rendering` → `rendering`.
The `encoding` and `uploading` stages are displayed optimistically (the backend
reports them as `rendering` until the MP4 is ready).

---

## 13. Database Schema

### `hf_jobs` — Render job store

```sql
CREATE TABLE IF NOT EXISTS hf_jobs (
  id           TEXT PRIMARY KEY,
  composition  TEXT NOT NULL,
  endpoint     TEXT NOT NULL DEFAULT 'jobs',
  status       TEXT NOT NULL DEFAULT 'queued',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms  INTEGER,
  url          TEXT,
  error        TEXT,
  callback_url TEXT,
  agent_id     TEXT,
  meta         JSONB DEFAULT '{}'::jsonb
);
```

### `hf_spend` — Daily render counter

```sql
CREATE TABLE IF NOT EXISTS hf_spend (
  date_key     TEXT PRIMARY KEY,   -- '2026-05-30'
  count        INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Index

```sql
CREATE INDEX IF NOT EXISTS idx_hf_jobs_status_created
  ON hf_jobs(status, created_at);
```

Supports the common query pattern: "Give me recent jobs, optionally filtered by
status" (used by `GET /api/jobs` and `GET /api/status`).

### Migration

`GET /api/migrate` runs `runMigrations()` which is idempotent
(`CREATE TABLE IF NOT EXISTS`). Called once per deploy. Could be automated
into the build step, but kept as a GET endpoint so it can be triggered manually.

---

## 14. File Structure

```
app/
├── api/
│   ├── compositions/route.ts         — GET list pre-bundled compositions
│   ├── generate/route.ts             — POST build + render from VideoSpec
│   ├── jobs/
│   │   ├── route.ts                  — POST create + GET list
│   │   └── [jobId]/route.ts          — GET poll + DELETE
│   ├── migrate/route.ts              — GET run DB migrations
│   ├── preview/
│   │   ├── route.ts                  — GET bundled preview HTML
│   │   ├── [...path]/route.ts        — GET preview static assets
│   │   └── comp/[...path]/route.ts   — GET sub-composition preview
│   ├── render/route.ts               — POST render pre-bundled (internal)
│   ├── render-generated/route.ts     — POST render dynamic HTML (internal)
│   ├── render-job/route.ts           — POST render from upload/published
│   ├── render-template/route.ts      — POST render from template spec
│   ├── runtime.js/route.ts           — GET hyperframes runtime IIFE
│   └── status/route.ts               — GET health + spend + queue
├── layout.tsx                        — Root layout
├── page.tsx                          — Studio GUI
├── globals.css                       — All CSS (no CSS modules for studio)
├── page.module.css                   — Layout-specific styles
components/studio/
├── StudioForm.tsx                    — Form: prompt, style, format, duration
├── PipelineProgress.tsx              — 6-stage pipeline + elapsed timer
├── JobHistory.tsx                    — Recent jobs list
└── studio-reducer.ts                 — State machine + form → VideoSpec
lib/
├── db.ts                             — Postgres pool + query helpers
├── job-store.ts                      — Job CRUD (create, get, update, list, delete)
├── spend-guard.ts                    — Daily render limiter (upsert-based)
├── migrate.ts                        — Schema migration (idempotent)
├── composition-builder.ts            — VideoSpec → HTML (pure TS)
├── templates.ts                      — Template factories (jewelry, youtube, price)
├── preview.ts                        — Preview serving + bundler
├── sandbox.ts                        — Vercel Sandbox wrapper + snapshot
└── preview.test.ts                   — 7 tests for preview module
public/compositions/
├── glow-card/                        — 57s music video (browser preview)
│   ├── index.html
│   ├── cinematic_plan.json
│   └── shots/                        — Scene images
└── vercel-intro/                     — 11s animated intro (template demo)
    ├── index.html
    └── assets/
scripts/
├── bundle-preview.ts                 — TSX bundler → inlined HTML
└── create-snapshot.ts                — Build-time sandbox snapshot
```

---

## 15. Known Risks & Future Work

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Snapshot expiration during deploy | Low | Renders fail until snapshot rebuilds | `create-snapshot.ts` runs in build; deploy won't complete until snapshot is ready |
| Detached promise silently fails | Medium | Job stuck in "restoring" | Error handler writes to job row; manual monitoring via `/api/status` |
| Connection pool exhaustion | Low | Queries hang | `max: 5` limits concurrency; most routes do 1-3 queries |
| `@vercel/kv` still in package.json | Low | Unnecessary dependency | Can remove; not imported anywhere |
| No rate limiting on `POST /api/render-job` | Medium | Unauthenticated renders | Will be addressed; currently trusts agent network |

### Future Work

1. **Extract `isAuthorized()` to `lib/auth.ts`** — Reduce duplication across
   5 route files. Each route currently duplicates the same 12-line function.

2. **Add health-check middleware on DB pool** — Detect connection failures
   before routes try to query.

3. **Async job runner with queue** — Replace detached promises with a proper
   queue (e.g., Vercel KV queues or a dedicated worker). This would survive
   cold starts and provide retry logic.

4. **Automate migration** — Run `runMigrations()` in a global middleware or
   edge function init, removing the manual `GET /api/migrate` step.

5. **Progress tracking in sandbox** — Report encoding/upload progress so the
   Studio GUI can show the full 6-stage pipeline accurately (currently
   `encoding` and `uploading` are optimistic guesses).

6. **Remove `@vercel/kv` from dependencies** — Left over from the original
   template; not used anywhere in this fork.
