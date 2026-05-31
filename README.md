# HyperFrames on Vercel

Preview HTML-based video compositions in the browser and render MP4s server-side — on Vercel. Powered by [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) for rendering and [Vercel Blob](https://vercel.com/docs/vercel-blob) for output storage.

[HyperFrames](https://github.com/heygen-com/hyperframes) is an open-source video rendering framework: write HTML + CSS + GSAP, get a reproducible MP4.

![Template preview showing the Vercel intro composition playing in the browser](./docs/preview.png)

**Live demo:** [hyperframes-on-vercel.vercel.app](https://hyperframes-on-vercel.vercel.app)

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?demo-title=HyperFrames+on+Vercel&demo-description=Preview+HTML+video+compositions+in+the+browser+and+render+MP4s+server-side+on+Vercel+Sandbox.&demo-image=https%3A%2F%2Fraw.githubusercontent.com%2Fheygen-com%2Fhyperframes-vercel-template%2Fmain%2Fdocs%2Fpreview.png&demo-url=https%3A%2F%2Fhyperframes-on-vercel.vercel.app&from=templates&project-name=hyperframes-on-vercel&repository-name=hyperframes-on-vercel&repository-url=https%3A%2F%2Fgithub.com%2Fheygen-com%2Fhyperframes-vercel-template&stores=%5B%7B%22type%22%3A%22blob%22%2C%22access%22%3A%22public%22%7D%5D)

Deploying provisions a Vercel Blob store; `BLOB_READ_WRITE_TOKEN` is injected automatically. Sandbox auth is handled at runtime via `VERCEL_OIDC_TOKEN` — no extra setup.

## What this template does

- **Preview** a bundled composition (`vercel-intro`) in the browser using `<hyperframes-player>`, the zero-dependency web component from `@hyperframes/player`.
- **Render** the composition to an MP4 by POSTing to `/api/render`. The route restores a pre-baked Vercel Sandbox, runs `hyperframes render`, uploads the MP4 to Vercel Blob, and returns a public URL.

**Authoring happens locally.** This template ships with one pre-authored composition. To build your own, use the HyperFrames CLI on your machine:

```bash
npx hyperframes init my-video
cd my-video
npx hyperframes preview   # live-reload editor in your browser
```

Then swap it into this template (see [Swapping the composition](#swapping-the-composition) below).

## Architecture

```
 Browser                   Vercel Functions (node)         Vercel Sandbox (Firecracker microVM)
┌──────────────────┐      ┌────────────────────────┐      ┌──────────────────────────────────┐
│ <hyperframes-    │ ───▶ │ /api/render            │ ──▶  │ (restored from snapshot, or      │
│  player>         │      │  - read composition    │      │  freshly provisioned in dev)     │
│ preview iframe   │      │  - writeFiles to sbox  │      │                                  │
│                  │      │  - runCommand: render  │      │  hyperframes render composition  │
│                  │ ◀──  │  - readFileToBuffer    │ ◀──  │    (Chromium + ffmpeg-static)    │
│                  │ url  │  - put() → Vercel Blob │  mp4 │                                  │
└──────────────────┘      └────────────────────────┘      └──────────────────────────────────┘
```

### The build-time snapshot

Cold render of the bundled ~11s composition is roughly 2 minutes. Most of that time is the actual Chromium render — not setup — because we pre-bake a sandbox **snapshot** at build time instead of installing dependencies on every request.

`scripts/create-snapshot.ts` runs as part of `next build`:

1. Spin up a fresh `node22` sandbox
2. `dnf install` Chromium system libraries (`nss`, `libXcomposite`, `pango`, …)
3. `npm install hyperframes ffmpeg-static ffprobe-static`
4. Symlink `ffmpeg-static/ffmpeg` and `ffprobe-static/bin/linux/x64/ffprobe` into `/usr/local/bin/`
5. `npx hyperframes browser ensure` to download chrome-headless-shell
6. `sandbox.snapshot({ expiration: 7 days })` and write the snapshot ID to a pointer blob at `snapshot-cache/<deployment_id>.json`

At render time, `lib/sandbox.ts`' `restoreOrCreate` reads the pointer blob, restores a sandbox from the snapshot in ~100 ms, writes the composition files, and runs `hyperframes render`. In non-production (local `vercel dev`) it falls back to a fresh setup automatically.

### Why Vercel Sandbox (and not a regular serverless function)

Vercel Functions cap at 300s and 50 MB compressed bundle — HyperFrames needs a full Chromium + FFmpeg at runtime, which busts the bundle limit. [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) is the purpose-built primitive for this workload: an Amazon Linux 2023 Firecracker microVM with sudo-level package installs, up to 5 hours of runtime, and up to 8 vCPUs (we use 4).

With 4 vCPUs, `hyperframes render --workers auto` launches 3 parallel Chrome workers, cutting the render time roughly 2× vs. the single-worker default.

## Local development

```bash
npm install
npm run dev
```

Browser preview works locally out of the box. The `/api/render` route needs Vercel Sandbox auth — run `vercel env pull .env.local` after linking the project to get `VERCEL_OIDC_TOKEN` locally, or use `vercel dev`.

## Project structure

```
app/
  api/render/route.ts    # POST → restore sandbox, render, upload to Blob
  page.tsx               # Preview + "Render" button
  layout.tsx
  globals.css
lib/
  sandbox.ts             # Snapshot-aware wrapper around @vercel/sandbox
scripts/
  create-snapshot.ts     # Build-time: pre-bake the sandbox snapshot
public/
  compositions/
    vercel-intro/        # The bundled example composition
      index.html
      assets/
```

## Swapping the composition

1. Drop your composition bundle into `public/compositions/<your-name>/`.
2. Update `PREVIEW_COMPOSITION_DIR` at the top of `lib/preview.ts` (used by both preview and render).
3. Optionally update `COMPOSITION_WIDTH` / `COMPOSITION_HEIGHT` at the top of `app/page.tsx` to match your composition's dimensions.

## Pricing

[Vercel Sandbox pricing](https://vercel.com/docs/vercel-sandbox/pricing) — Pro plans include \$20/mo in Sandbox credit. At ~2 minutes per render on 4 vCPUs, that covers roughly 100 renders/month of the bundled ~11-second example. Snapshot storage (the ~1.1 GB snapshot per deployment) is included in Sandbox pricing.

## License

[Apache-2.0](./LICENSE) — same license as HyperFrames itself.

## Links

- [HyperFrames repo](https://github.com/heygen-com/hyperframes)
- [HyperFrames docs](https://hyperframes.heygen.com)
- [Vercel Sandbox docs](https://vercel.com/docs/vercel-sandbox)
- [Vercel Blob docs](https://vercel.com/docs/vercel-blob)
