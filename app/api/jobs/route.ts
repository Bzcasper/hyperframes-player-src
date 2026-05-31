/*
 * HyperFrames Render API — Agent Contract
 *
 * SUBMIT JOB (fire-and-forget async render):
 *   POST /api/jobs
 *   Authorization: Bearer <RENDER_API_KEY>
 *   Content-Type: application/json
 *   Body: {
 *     "composition": "vercel-intro",       // required
 *     "callbackUrl": "https://...",        // optional webhook on completion
 *     "agentId": "hermes",                 // optional agent identifier
 *     "meta": { "task": "promo-video" }   // optional key-value tags
 *   }
 *   → 202 { jobId, status: "queued", pollUrl, composition, createdAt }
 *   → 400 { error } on validation failure
 *   → 401 { error } on auth failure
 *
 * POLL STATUS:
 *   GET /api/jobs/<jobId>
 *   → 200 RenderJob — poll every 10s until finished === true
 *   → status lifecycle: queued → restoring → rendering → done | failed
 *   → on done: url field contains public MP4 Blob URL
 *   → on failed: error field contains failure message
 *
 * LIST JOBS:
 *   GET /api/jobs?limit=20&agentId=hermes
 *   → 200 { jobs: RenderJob[], total: number }
 *
 * LIST COMPOSITIONS:
 *   GET /api/compositions
 *   → 200 { compositions: string[] }
 *
 * TYPICAL AGENT FLOW (Hermes/OpenClaw skill):
 *   1. GET /api/compositions → pick target composition
 *   2. POST /api/jobs → receive jobId
 *   3. Poll GET /api/jobs/<jobId> every 10s
 *   4. When finished === true && status === "complete" → use url
 *   5. OR: provide callbackUrl at step 2 and skip polling entirely
 *
 * ENVIRONMENT VARIABLES REQUIRED:
 *   RENDER_API_KEY   — shared secret for job submission (optional in dev)
 *   VERCEL_URL       — injected by Vercel, used for internal render call
 *   VERCEL_OIDC_TOKEN — injected by Vercel, passed to /api/render
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  createJob,
  getJob,
  listJobs,
  updateJob,
  type RenderJob,
} from "@/lib/job-store";
import { checkSpendLimit } from "@/lib/spend-guard";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Verify a Bearer token against RENDER_API_KEY using a timing-safe comparison.
 * If RENDER_API_KEY is not set, auth is skipped (dev mode) and this returns true.
 */
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

interface SubmitJobBody {
  composition?: unknown;
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

  let body: SubmitJobBody;
  try {
    body = (await req.json()) as SubmitJobBody;
  } catch {
    return NextResponse.json(
      { error: "composition is required" },
      { status: 400 },
    );
  }

  const composition =
    typeof body.composition === "string" ? body.composition.trim() : "";
  if (!composition) {
    return NextResponse.json(
      { error: "composition is required" },
      { status: 400 },
    );
  }

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

  const agentId =
    typeof body.agentId === "string" ? body.agentId : undefined;

  let meta: Record<string, string> | undefined;
  if (body.meta && typeof body.meta === "object" && !Array.isArray(body.meta)) {
    meta = {};
    for (const [key, value] of Object.entries(body.meta)) {
      if (typeof value === "string") meta[key] = value;
    }
  }

  const job = await createJob({
    composition,
    endpoint: "jobs",
    callbackUrl,
    agentId,
    meta,
  });

  // Fire the render in a detached IIFE — do NOT await before responding.
  void runRender(job.id, composition);

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

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);

  const rawLimit = Number.parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = Number.isNaN(rawLimit)
    ? 20
    : Math.min(Math.max(rawLimit, 1), 100);
  const agentId = searchParams.get("agentId");

  let jobs = await listJobs(100);
  if (agentId) {
    jobs = jobs.filter((job) => job.agentId === agentId);
  }
  jobs = jobs.slice(0, limit);

  return NextResponse.json({ jobs, total: jobs.length });
}

/**
 * Detached render runner. Drives the job through its status lifecycle by
 * calling the existing /api/render endpoint internally, then optionally fires
 * a webhook callback. Never throws — all failures are captured on the job.
 */
async function runRender(id: string, composition: string): Promise<void> {
  await updateJob(id, {
    status: "restoring",
    startedAt: new Date().toISOString(),
  });

  const origin = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  try {
    await updateJob(id, { status: "preprocessing" });

    const res = await fetch(`${origin}/api/render`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.VERCEL_OIDC_TOKEN
          ? { Authorization: `Bearer ${process.env.VERCEL_OIDC_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ composition }),
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
      status: "complete",
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

    console.error(`[/api/jobs] job ${id} failed: ${message}`);

    if (failed) await fireCallback(failed, "render.failed");
  }
}

/**
 * Fire-and-forget webhook callback. Never throws.
 */
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
