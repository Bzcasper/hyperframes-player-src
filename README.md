# HyperFrames Player — Async Video Render Service

Preview HTML-based video compositions in the browser and render MP4s server-side on Vercel. Powered by [HyperFrames](https://github.com/heygen-com/hyperframes) for composition authoring, [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) for server-side rendering (Firecracker microVMs with Chromium + FFmpeg), and [Vercel Blob](https://vercel.com/docs/vercel-blob) for output storage.

This repo started as the official [`heygen-com/hyperframes-vercel-template`](https://github.com/heygen-com/hyperframes-vercel-template) but has been heavily customized into a stateful async render service.

**Key additions vs. upstream:**
- **Persistent Postgres stores** (Neon) — job history and daily spend counters survive cold starts
- **Three agent-facing API endpoints** — `POST /api/generate` (declarative VideoSpec), `POST /api/render-template` (named templates with typed params), `POST /api/jobs` (pre-bundled compositions)
- **Webhook callbacks** — optional `callbackUrl` on any job fires `POST` with `X-HyperFrames-Event: render.complete|render.failed`
- **Bearer auth** — `RENDER_API_KEY` with `timingSafeEqual` verification; dev mode when unset
- **Spend guard** — daily render limit tracked in Postgres, configurable via `MAX_RENDERS_PER_DAY` (default 20), returns 429 on overage
- **Studio GUI** — full React form at `/` with style presets, pipeline progress tracker, and auto-polling job history
- **Two bundled compositions** — `glow-card` (57s rap video with glitch transitions) + `vercel-intro` (11s Three.js / GSAP animated intro)

![Template preview showing the Vercel intro composition playing in the browser](./docs/preview.png)

---

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?demo-title=HyperFrames+on+Vercel&demo-description=Preview+HTML+video+compositions+in+the+browser+and+render+MP4s+server-side+on+Vercel+Sandbox.&demo-image=https%3A%2F%2Fraw.githubusercontent.com%2Fheygen-com%2Fhyperframes-vercel-template%2Fmain%2Fdocs%2Fpreview.png&demo-url=https%3A%2F%2Fhyperframes-on-vercel.vercel.app&from=templates&project-name=hyperframes-on-vercel&repository-name=hyperframes-on-vercel&repository-url=https%3A%2F%2Fgithub.com%2Fheygen-com%2Fhyperframes-vercel-template&stores=%5B%7B%22type%22%3A%22blob%22%2C%22access%22%3A%22public%22%7D%5D)

Deploying provisions a Vercel Blob store (BLOB_READ_WRITE_TOKEN auto-injected). **You will also need a Neon Postgres database** — add `POSTGRES_URL` as an environment variable after deploy, or set it during initial setup via the Vercel dashboard.

Sandbox auth is handled at runtime via `VERCEL_OIDC_TOKEN` — no extra setup.

---

## Architecture

```
 Browser / Agent API               Vercel Functions (node)                   Neon Postgres
┌─────────────────────────┐       ┌─────────────────────────────────┐       ┌──────────────┐
│  Studio GUI (/)          │       │  POST /api/generate             │       │  hf_jobs     │
│  ┌─────────────────┐    │       │    validate VideoSpec           │──▶───│  hf_spend    │
│  │ Form: prompt,   │    │──────▶│    buildCompositionHtml()       │       └──────────────┘
│  │ style, format…  │    │       │    createJob() → Postgres       │
│  │                 │    │       │    runGeneratedRender() (detach)│
│  │ Pipeline: 6     │    │       └─────────────────────────────────┘
│  │ stages + timer  │    │       ┌─────────────────────────────────┐
│  │                 │    │       │  POST /api/render-template      │
│  │ Job history     │    │──────▶│    resolve template factory     │
│  └─────────────────┘    │       │    buildCompositionHtml()       │
│                         │       │    runTemplateRender() (detach)  │
│  Agent (Hermes, n8n…)   │       └─────────────────────────────────┘
│  ┌─────────────────┐    │       ┌─────────────────────────────────┐
│  │ POST /api/jobs  │    │──────▶│  POST /api/jobs                 │
│  │ POST /api/      │    │       │    createJob() → Postgres       │
│  │   render-       │    │       │    runRender() (detach)         │
│  │   template      │    │       └─────────────────────────────────┘
│  │ POST /api/      │    │       ┌─────────────────────────────────┐
│  │   generate      │    │       │  GET /api/jobs                  │
│  │ GET /api/       │    │◀──────│  GET /api/jobs/[jobId]          │
│  │   jobs          │    │       │  GET /api/compositions          │
│  │ GET /api/status │    │       │  GET /api/status                │
│  └─────────────────┘    │       │  GET /api/migrate               │
│                         │       └────────┬────────────────────────┘
│  <hyperframes-player>   │                │ internal call
│  (preview iframe)       │       ┌────────▼────────────────────────┐
│                         │       │  POST /api/render-generated     │
│                         │       │  POST /api/render               │
│                         │       └────────┬────────────────────────┘
└─────────────────────────┘                │
                                           ▼
                              Vercel Sandbox (Firecracker microVM)
                              ┌─────────────────────────────────────┐
                              │  (restored from snapshot, or fresh) │
                              │                                     │
                              │  hyperframes render composition     │
                              │    (Chromium + ffmpeg-static)       │
                              │                                     │
                              │  out.mp4 → @vercel/blob (public)    │
                              └─────────────────────────────────────┘
```

### The build-time snapshot

Cold render of the bundled ~11s composition is roughly 2 minutes. Most of that time is the actual Chromium render — not setup — because we pre-bake a sandbox **snapshot** at build time instead of installing dependencies on every request.

`scripts/create-snapshot.ts` runs as part of `next build`:

1. Spin up a fresh `node22` sandbox
2. `dnf install` Chromium system libraries (nss, libXcomposite, pango, …)
3. `npm install hyperframes ffmpeg-static ffprobe-static`
4. Symlink `ffmpeg-static/ffmpeg` and `ffprobe-static/bin/linux/x64/ffprobe` into `/usr/local/bin/`
5. `npx hyperframes browser ensure` to download chrome-headless-shell
6. `sandbox.snapshot({ expiration: 7 days })` and write the snapshot ID to a pointer blob at `snapshot-cache/<deployment_id>.json`

At render time, `lib/sandbox.ts`' `restoreOrCreate` reads the pointer blob, restores a sandbox from the snapshot in ~100 ms, writes the composition files, and runs `hyperframes render`. In non-production (local `vercel dev`) it falls back to a fresh setup automatically.

### Why Vercel Sandbox (and not a regular serverless function)

Vercel Functions cap at 300s and 50 MB compressed bundle — HyperFrames needs a full Chromium + FFmpeg at runtime, which busts the bundle limit. [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) is the purpose-built primitive for this workload: an Amazon Linux 2023 Firecracker microVM with sudo-level package installs, up to 5 hours of runtime, and up to 8 vCPUs (we use 4).

With 4 vCPUs, `hyperframes render --workers auto` launches 3 parallel Chrome workers, cutting the render time roughly 2× vs. the single-worker default.

---

## Local development

```bash
pnpm install
pnpm dev
```

The project uses **pnpm** (with `pnpm-workspace.yaml`). The npm lockfile (`package-lock.json`) is present for Vercel deployment compatibility.

**Required environment variables for local dev:**

```bash
# Required: Vercel Blob token (rendered MP4 upload destination).
# Auto-provisioned on Vercel; locally run: vercel env pull
BLOB_READ_WRITE_TOKEN=

# Required: Neon Postgres connection string.
POSTGRES_URL=postgres://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb

# Optional: Bearer auth for the API (omitted = dev mode, all endpoints open)
RENDER_API_KEY=

# Optional: daily render cap (default: 20)
MAX_RENDERS_PER_DAY=20

# Sandbox auth (automatic on Vercel via VERCEL_OIDC_TOKEN).
# For local dev against a real sandbox: vercel env pull
```

Browser preview works locally out of the box. The render APIs need Vercel Sandbox auth — run `vercel env pull .env.local` after linking the project, or use `vercel dev`.

---

## Database setup

All job and spend data is stored in **Neon Postgres** via the `pg` package. Two tables:

- **`hf_jobs`** — job records with status lifecycle, composition, timestamps, URLs, callback info, agent ID, and meta tags
- **`hf_spend`** — daily render counters keyed by UTC date, for rate limiting

After deploying, hit the migration endpoint to create the tables (idempotent — safe to call repeatedly):

```
GET /api/migrate
→ 200 { ok: true, migrated: true }
```

The endpoint uses `CREATE TABLE IF NOT EXISTS` and creates the `idx_hf_jobs_status_created` index.

---

## Studio GUI

The root route (`/`) provides a browser-based video generation interface:

- **Form:** prompt text, style preset (Cinematic / Minimal / Vibrant / Corporate), duration (5–30s), aspect ratio (16:9 / 9:16 / 1:1), animation intensity (Subtle / Balanced / Dynamic), subtitles toggle
- **Preview player:** embedded `<hyperframes-player>` web component showing the currently selected composition (defaults to `glow-card`)
- **Pipeline progress:** 6-stage tracker (Validating → Building → Restoring → Rendering → Encoding → Uploading) with elapsed timer, driven by polling `GET /api/jobs/[jobId]`
- **Job history sidebar:** auto-polling list of recent jobs with status badges and direct MP4 download links

The Studio calls `POST /api/generate` under the hood, passing a constructed `VideoSpec` matching the form state.

---

## API reference

This service exposes three job-submission endpoints plus polling and management routes. All job-submission endpoints require Bearer auth (unless `RENDER_API_KEY` is unset) and return `202 { jobId, pollUrl }`.

| Endpoint | Purpose |
|----------|---------|
| `POST /api/jobs` | Submit a pre-bundled composition by name (e.g. `"vercel-intro"`) |
| `POST /api/generate` | Submit a declarative `VideoSpec` with text, video, image, and audio clips |
| `POST /api/render-template` | Submit a named template (`jewelry-reveal`, `youtube-intro`, `price-drop`) with typed params |
| `GET /api/jobs` | List recent jobs (query params: `limit`, `agentId`) |
| `GET /api/jobs/[jobId]` | Poll a single job — poll until `finished === true` |
| `DELETE /api/jobs/[jobId]` | Delete a job (auth required) |
| `GET /api/compositions` | List available pre-bundled composition directories |
| `GET /api/status` | Health check — spend, queue breakdown, endpoint catalog, available templates |
| `GET /api/migrate` | Run database migrations (idempotent) |

**Full API contracts, request/response schemas, validation rules, and template parameter docs** are in [AGENTS.md](./AGENTS.md).

### Quick start (agent workflow)

```
1. GET  /api/status          → confirm health, check remaining budget
2. POST /api/render-template → receive jobId (202)
   { "template": "jewelry-reveal", "params": { "compositionId": "ring-001", ... } }
3. Poll GET /api/jobs/<jobId> every 5–10s until finished === true
4. Use url field (public MP4) when status === "done"
```

Or provide a `callbackUrl` at submission to skip polling entirely — the service fires a `POST` to your webhook with `X-HyperFrames-Event: render.complete` when the MP4 is ready.

---

## Compositions (bundled)

Two pre-authored composition bundles ship with this template:

### `glow-card/`

- **Duration:** ~57s
- **Content:** Music video with rap lyrics, glitch transitions, 3D rotation effects, grain overlay
- **Directory:** `public/compositions/glow-card/`

### `vercel-intro/`

- **Duration:** ~11s
- **Content:** Animated intro using Three.js (WebGL shader), GSAP, and Anime.js
- **Directory:** `public/compositions/vercel-intro/`

### Adding a new composition

1. Drop your composition bundle into `public/compositions/<your-name>/` with an `index.html` and any assets
2. The composition is automatically available via `GET /api/compositions` and can be submitted via `POST /api/jobs` with `"composition": "<your-name>"`
3. To make it the default preview, update `PREVIEW_COMPOSITION_DIR` in `lib/preview.ts`

---

## Adding new templates

Templates live in `lib/templates.ts`. Each template is a factory function that returns a `VideoSpec` from typed params:

```ts
export function yourTemplateSpec(params: YourParams): VideoSpec {
  return {
    compositionId: params.compositionId,
    width: 1080,
    height: 1080,
    totalDuration: 10,
    backgroundColor: "#0a0a0f",
    clips: [
      {
        type: "text",
        id: "headline",
        content: params.title,
        start: 0.5,
        duration: 9,
        track: 1,
        style: "top:40%; left:50%; font-size:64px;",
        animation: { entrance: "fade-up" },
      },
    ],
  };
}
```

Then register it in `app/api/render-template/route.ts` — add the name to `VALID_TEMPLATES` and add a case in `buildSpecForTemplate`. That's it. The template is immediately available to agents via `POST /api/render-template`.

---

## Pricing

[Vercel Sandbox pricing](https://vercel.com/docs/vercel-sandbox/pricing) — Pro plans include $20/mo in Sandbox credit. At ~2 minutes per render on 4 vCPUs, that covers roughly 100 renders/month of the bundled ~11-second example. Snapshot storage (the ~1.1 GB snapshot per deployment) is included in Sandbox pricing.

Neon Postgres has a generous free tier (3 GB storage, 100 h/month compute) that easily handles the job/spend tables.

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_URL` (or `DATABASE_URL`) | Yes | Neon Postgres connection string |
| `BLOB_READ_WRITE_TOKEN` | Yes | Vercel Blob token (auto-provisioned by deploy) |
| `RENDER_API_KEY` | Dev-optional | Bearer token for API auth; unset = dev mode |
| `MAX_RENDERS_PER_DAY` | No | Daily render limit (default: 20) |
| `VERCEL_OIDC_TOKEN` | For internal render | Auto-injected by Vercel for Sandbox auth |
| `VERCEL_URL` | For internal render | Auto-injected by Vercel, used for self-call origin |

---

## Project structure

```
app/
  page.tsx                     # Studio GUI — form, pipeline progress, job history
  page.module.css
  layout.tsx
  globals.css
  api/
    jobs/route.ts              # POST (submit) + GET (list) jobs
    jobs/[jobId]/route.ts      # GET (poll) + DELETE a single job
    generate/route.ts          # POST — declarative VideoSpec → 202 jobId
    render-template/route.ts   # POST — named template with params → 202 jobId
    render/route.ts            # POST — legacy, renders PREVIEW_COMPOSITION_DIR
    render-generated/route.ts  # Internal: sandbox render from generated HTML
    render-job/route.ts        # Internal: sandbox render by job ID
    compositions/route.ts      # GET — list available composition directories
    preview/route.ts           # GET — bundled composition preview HTML
    preview/[...path]/route.ts # GET — composition asset files
    preview/comp/[...path]/    # GET — sub-composition preview HTML
      route.ts
    runtime.js/route.ts        # GET — hyperframe runtime JS
    migrate/route.ts           # GET — run DB migrations (idempotent)
    status/route.ts            # GET — health, spend, queue, endpoint catalog
components/
  studio/
    StudioForm.tsx             # Prompt + style + duration + format form
    PipelineProgress.tsx       # 6-stage progress tracker with elapsed timer
    JobHistory.tsx             # Auto-polling job list with download links
    studio-reducer.ts          # Generation state machine + VideoSpec factory
lib/
  composition-builder.ts       # VideoSpec → HTML template builder
  templates.ts                 # Template factories (jewelry-reveal, youtube-intro, price-drop)
  job-store.ts                 # Postgres CRUD for hf_jobs
  spend-guard.ts               # Daily render limit via hf_spend
  db.ts                        # pg Pool wrapper
  migrate.ts                   # Idempotent migration SQL
  sandbox.ts                   # Snapshot-aware Vercel Sandbox wrapper
  preview.ts                   # Composition preview file serving + bundling
  preview.test.ts              # Unit tests for preview module
scripts/
  create-snapshot.ts           # Build-time: pre-bake sandbox snapshot (~1.1 GB)
  bundle-preview.ts            # Build-time: bundle composition HTML for preview
public/
  compositions/
    glow-card/                 # 57s rap music video composition
      index.html
      cinematic_plan.json
      shots/
    vercel-intro/              # 11s Three.js/GSAP animated intro
      index.html
      assets/
docs/
  preview.png                  # Screenshot for Deploy button
AGENTS.md                      # Full API contract reference
```

---

## License

[Apache-2.0](./LICENSE) — same license as HyperFrames itself.

---

## Links

- [HyperFrames repo](https://github.com/heygen-com/hyperframes)
- [HyperFrames docs](https://hyperframes.heygen.com)
- [Vercel Sandbox docs](https://vercel.com/docs/vercel-sandbox)
- [Vercel Blob docs](https://vercel.com/docs/vercel-blob)
- [Neon Postgres](https://neon.tech)
