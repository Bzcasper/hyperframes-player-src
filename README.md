# HyperFrames on Vercel

Preview HyperFrames compositions in the browser and render MP4s server-side — on Vercel. Powered by [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) (Chrome + FFmpeg preinstalled) and [Vercel Blob](https://vercel.com/docs/vercel-blob) for storage.

[HyperFrames](https://github.com/heygen-com/hyperframes) is an open-source video rendering framework: write HTML + CSS + GSAP, get a reproducible MP4.

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fheygen-com%2Fhyperframes-vercel-template&stores=%5B%7B%22type%22%3A%22blob%22%7D%5D)

Deploying provisions a Vercel Blob store; the `BLOB_READ_WRITE_TOKEN` env var is injected automatically. Sandbox auth is provided via `VERCEL_OIDC_TOKEN` at runtime — no extra setup.

## What this template does

- **Preview** a bundled composition (`product-promo`) using `<hyperframes-player>`, the zero-dependency web component from `@hyperframes/player`.
- **Render** that composition to MP4 by POSTing to `/api/render`. The route spawns a [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) microVM, installs the `hyperframes` CLI, runs `hyperframes render`, uploads the MP4 to Vercel Blob, and returns a public URL.

**Authoring happens locally.** This template ships with one pre-authored composition. To build your own, use the HyperFrames CLI on your machine:

```bash
npx hyperframes init my-video
cd my-video
npx hyperframes preview   # live-reload editor in your browser
```

Then copy the result into this template's `public/compositions/` folder and update the entry path in `app/page.tsx` + `app/api/render/route.ts`.

## Architecture

```
 Browser                     Vercel (Node runtime)             Vercel Sandbox (microVM)
┌────────────────┐          ┌─────────────────────┐           ┌────────────────────────┐
│ <hyperframes-  │  ──────▶ │ /api/render         │ ──spawn──▶│  npm install hyperframes│
│  player>       │          │  - walks public/    │           │  npx hyperframes render │
│ (preview)      │          │    compositions     │           │  Chrome + FFmpeg (built-in)
│                │          │  - writes into sbox │           │                        │
│                │ ◀──────  │  - readFile(mp4)    │ ◀──mp4────│                        │
│                │   url    │  - put() → Blob     │           │                        │
└────────────────┘          └─────────────────────┘           └────────────────────────┘
```

**Why Sandbox instead of Vercel Functions?** Functions cap at 300s and 50 MB compressed bundle — HyperFrames needs full Chromium (via Puppeteer) + FFmpeg at runtime, which busts the bundle limit. [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) is the purpose-built primitive for this workload: Amazon Linux 2023, Chrome and FFmpeg preinstalled, up to 5 hours (Pro).

## Local development

```bash
npm install
npm run dev
```

The preview works locally out of the box. The `/api/render` route needs Vercel Sandbox auth — run `vercel env pull` after linking the project to get `VERCEL_OIDC_TOKEN` locally, or test rendering via `vercel dev`.

## Project structure

```
app/
  api/render/route.ts    # POST → spawn sandbox, render, upload to Blob
  page.tsx               # Preview + "Render" button
  layout.tsx
  globals.css
lib/
  sandbox.ts             # Thin wrapper around @vercel/sandbox
public/
  compositions/
    product-promo/       # The bundled example composition
      index.html
      compositions/*.html
      assets/*.svg
```

## Swapping the composition

1. Drop your composition bundle into `public/compositions/<your-name>/`.
2. Update the two constants at the top of `app/page.tsx` (`COMPOSITION_SRC`, dimensions) and the `COMPOSITION_DIR` in `app/api/render/route.ts`.

## Pricing notes

Vercel Sandbox pricing ([docs](https://vercel.com/docs/vercel-sandbox/pricing)) — Pro plans include $20/mo in Sandbox credit, which covers roughly a few hundred renders of this 20-second example. A 20-second render typically takes 30–90 seconds of Sandbox time.

## License

[Apache-2.0](./LICENSE) — same license as HyperFrames itself.

## Links

- [HyperFrames repo](https://github.com/heygen-com/hyperframes)
- [HyperFrames docs](https://hyperframes.heygen.com)
- [Vercel Sandbox docs](https://vercel.com/docs/vercel-sandbox)
- [Vercel Blob docs](https://vercel.com/docs/vercel-blob)
