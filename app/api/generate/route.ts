/*
 * HyperFrames Dynamic Generation API — Agent Contract
 *
 * GENERATE + RENDER A VIDEO FROM SPEC (no pre-authored HTML needed):
 *   POST /api/generate
 *   Authorization: Bearer <RENDER_API_KEY>
 *   Content-Type: application/json
 *   Body: {
 *     "spec": {
 *       "compositionId": "product-promo-001",  // slug, lowercase, hyphens only
 *       "width": 1920,
 *       "height": 1080,
 *       "totalDuration": 15,
 *       "backgroundColor": "#0a0a0f",
 *       "clips": [
 *         {
 *           "type": "video",
 *           "id": "bg",
 *           "src": "https://cdn.example.com/bg.mp4",
 *           "start": 0,
 *           "track": 0,
 *           "volume": 0
 *         },
 *         {
 *           "type": "text",
 *           "id": "headline",
 *           "content": "New Product Drop",
 *           "start": 1,
 *           "duration": 8,
 *           "track": 2,
 *           "style": "top:40%; left:50%; transform:translateX(-50%); color:#fff; font-size:96px; font-weight:900;",
 *           "animation": { "entrance": "fade-up", "exit": "fade-out" }
 *         },
 *         {
 *           "type": "audio",
 *           "id": "music",
 *           "src": "https://cdn.example.com/track.mp3",
 *           "start": 0,
 *           "track": 1,
 *           "volume": 0.4
 *         }
 *       ]
 *     },
 *     "callbackUrl": "https://n8n.trapmoney.dpdns.org/webhook/video-done",
 *     "agentId": "hermes"
 *   }
 *   → 202 { jobId, status: "queued", pollUrl, composition, createdAt }
 *
 * POLL: same as job API — GET /api/jobs/<jobId>
 * DONE: url field = public MP4 Blob URL
 *
 * TYPICAL HERMES SKILL FLOW:
 *   1. Build VideoSpec object from task context
 *   2. POST /api/generate with spec + callbackUrl pointing to Hermes webhook
 *   3. Receive jobId in 202
 *   4. Continue other work — callback fires when MP4 is ready
 *   5. Hermes receives callback POST with full RenderJob including url
 *   6. Use url in downstream workflow (post to YouTube, embed in email, etc.)
 *
 * VALIDATION RULES:
 *   - compositionId: /^[a-z0-9-]+$/
 *   - All clip ids must be unique
 *   - No two clips on the same track may time-overlap
 *   - text and image clips require duration
 *   - width, height, totalDuration must be positive numbers
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCompositionHtml,
  validateCompositionHtml,
  validateVideoSpec,
  type VideoSpec,
} from "@/lib/composition-builder";
import { createJob, updateJob, getJob, type RenderJob } from "@/lib/job-store";
import { checkSpendLimit } from "@/lib/spend-guard";

export const runtime = "nodejs";
export const maxDuration = 300;

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

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

interface GenerateBody {
  spec?: unknown;
  callbackUrl?: unknown;
  agentId?: unknown;
  meta?: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Daily render cost guard.
  const guard = await checkSpendLimit();
  if (!guard.allowed) {
    return NextResponse.json(
      { error: guard.message, resetAt: guard.resetAt, limit: guard.limit },
      { status: 429 },
    );
  }

  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid spec", details: "Request body is not valid JSON" },
      { status: 400 },
    );
  }

  if (!validateVideoSpec(body.spec)) {
    return NextResponse.json(
      {
        error: "Invalid spec",
        details: "spec is missing required fields or has wrong types",
      },
      { status: 400 },
    );
  }
  const spec: VideoSpec = body.spec;

  let html: string;
  try {
    html = buildCompositionHtml(spec);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Composition build failed",
        details: err instanceof Error ? err.message : "Unknown build error",
      },
      { status: 400 },
    );
  }

  // Optional callbackUrl validation.
  let callbackUrl: string | undefined;
  if (body.callbackUrl !== undefined && body.callbackUrl !== null) {
    if (typeof body.callbackUrl !== "string" || !isValidUrl(body.callbackUrl)) {
      return NextResponse.json(
        { error: "callbackUrl must be a valid URL" },
        { status: 400 },
      );
    }
    callbackUrl = body.callbackUrl;
  }

  const agentId = typeof body.agentId === "string" ? body.agentId : undefined;

  let meta: Record<string, string> | undefined;
  if (body.meta && typeof body.meta === "object" && !Array.isArray(body.meta)) {
    meta = {};
    for (const [key, value] of Object.entries(body.meta)) {
      if (typeof value === "string") meta[key] = value;
    }
  }

  // Write the generated HTML to a temp dir (best-effort; the sandbox renders
  // from the in-memory html string, so a failure here is non-fatal).
  let tempDir: string | null = null;
  try {
    tempDir = join(tmpdir(), `hf-gen-${spec.compositionId}-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, "index.html"), html, "utf-8");
  } catch (err) {
    console.error("[/api/generate] temp dir write failed", err);
    tempDir = null;
  }

  const job = await createJob({
    composition: spec.compositionId,
    endpoint: "generate",
    callbackUrl,
    agentId,
    meta,
  });

  // Detached render — do NOT await before responding.
  void runGeneratedRender(job.id, spec, html, tempDir);

  return NextResponse.json(
    {
      jobId: job.id,
      status: job.status,
      pollUrl: `/api/jobs/${job.id}`,
      composition: job.composition,
      createdAt: job.createdAt,
    },
    { status: 202 },
  );
}

/**
 * Detached runner for generated compositions. Drives the job lifecycle by
 * calling /api/render-generated internally, fires the optional webhook, and
 * cleans up the temp directory. Never throws.
 */
async function runGeneratedRender(
  id: string,
  spec: VideoSpec,
  html: string,
  tempDir: string | null,
): Promise<void> {
  await updateJob(id, {
    status: "restoring",
    startedAt: new Date().toISOString(),
  });

  // Pre-flight lint — catches FATAL composition errors before spending credits.
  const lintErrors = validateCompositionHtml(html);
  if (lintErrors.length > 0) {
    await updateJob(id, {
      status: "failed",
      error: "Pre-flight lint failed:\n" + lintErrors.join("\n"),
      completedAt: new Date().toISOString(),
    });
    return;
  }

  const origin = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  try {
    await updateJob(id, { status: "preprocessing" });

    const res = await fetch(`${origin}/api/render-generated`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.RENDER_API_KEY
          ? { Authorization: `Bearer ${process.env.RENDER_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        compositionId: spec.compositionId,
        html,
        width: spec.width,
        height: spec.height,
      }),
    });

    if (!res.ok) {
      let message = `Render failed with status ${res.status}`;
      try {
        const errBody = (await res.json()) as { error?: string };
        if (errBody.error) message = errBody.error;
      } catch {
        // ignore body parse errors
      }
      throw new Error(message);
    }

    const data = (await res.json()) as { url?: string };
    if (!data.url) {
      throw new Error("Render response did not include a url");
    }

    const completedAt = new Date().toISOString();
    const jobRow = await getJob(id);
    const startedAt = jobRow?.startedAt ?? null;
    const durationMs = startedAt
      ? Date.parse(completedAt) - Date.parse(startedAt)
      : null;

    const finished = await updateJob(id, {
      status: "done",
      url: data.url,
      completedAt,
      durationMs,
    });

    if (finished) await fireCallback(finished, "render.complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Render failed";
    const completedAt = new Date().toISOString();
    const jobRow = await getJob(id);
    const startedAt = jobRow?.startedAt ?? null;
    const durationMs = startedAt
      ? Date.parse(completedAt) - Date.parse(startedAt)
      : null;

    const failed = await updateJob(id, {
      status: "failed",
      error: message,
      completedAt,
      durationMs,
    });

    console.error(`[/api/generate] job ${id} failed: ${message}`);

    if (failed) await fireCallback(failed, "render.failed");
  } finally {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (err) {
        console.error("[/api/generate] temp dir cleanup failed", err);
      }
    }
  }
}

async function fireCallback(
  job: RenderJob,
  event: "render.complete" | "render.failed",
): Promise<void> {
  if (!job.callbackUrl) return;

  try {
    await fetch(job.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HyperFrames-Event": event,
        "X-HyperFrames-Job-Id": job.id,
      },
      body: JSON.stringify(job),
    });
  } catch {
    // A failed callback must never affect the job.
  }
}
