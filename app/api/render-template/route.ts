/*
 * Template Render API — Agent Contract
 *
 * The fastest path from agent intent to MP4. No VideoSpec construction needed.
 * Pick a template, pass named params, get a jobId back in 202ms.
 *
 * JEWELRY LISTING (Hermes jewelry pipeline):
 *   POST /api/render-template
 *   { "template": "jewelry-reveal",
 *     "params": { "compositionId": "bracelet-001", "title": "Tennis Bracelet",
 *                 "productImageUrl": "https://res.cloudinary.com/...",
 *                 "price": "$89", "subtitle": "Estate Collection" },
 *     "callbackUrl": "https://n8n.trapmoney.dpdns.org/webhook/video-done",
 *     "agentId": "hermes" }
 *
 * YOUTUBE CONTENT (OpenClaw content pipeline):
 *   POST /api/render-template
 *   { "template": "youtube-intro",
 *     "params": { "compositionId": "ep-042-intro", "channelName": "@CreationcompanionDIY",
 *                 "episodeTitle": "Building AI Video Pipelines in 2026" },
 *     "callbackUrl": "https://n8n.trapmoney.dpdns.org/webhook/video-done",
 *     "agentId": "openclaw" }
 *
 * PRICE DROP ALERT (Hermes eBay deal scout → Whatnot/Mercari):
 *   POST /api/render-template
 *   { "template": "price-drop",
 *     "params": { "compositionId": "deal-14k-ring", "productName": "14k Ring",
 *                 "originalPrice": "$299", "salePrice": "$149", "badgeText": "50% OFF" },
 *     "agentId": "hermes" }
 *
 * POLL: GET /api/jobs/<jobId> — check finished === true, then use url field
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  jewelryRevealSpec,
  youtubeIntroSpec,
  priceDropSpec,
  type JewelryRevealParams,
  type YouTubeIntroParams,
  type PriceDropParams,
} from "@/lib/templates";
import {
  buildCompositionHtml,
  type VideoSpec,
} from "@/lib/composition-builder";
import { createJob, updateJob, getJob, type RenderJob } from "@/lib/job-store";
import { checkSpendLimit } from "@/lib/spend-guard";

export const runtime = "nodejs";
export const maxDuration = 300;

const VALID_TEMPLATES = new Set([
  "jewelry-reveal",
  "youtube-intro",
  "price-drop",
]);
type TemplateName = "jewelry-reveal" | "youtube-intro" | "price-drop";

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

function buildSpecForTemplate(
  template: TemplateName,
  params: Record<string, unknown>,
): VideoSpec {
  switch (template) {
    case "jewelry-reveal":
      return jewelryRevealSpec(params as unknown as JewelryRevealParams);
    case "youtube-intro":
      return youtubeIntroSpec(params as unknown as YouTubeIntroParams);
    case "price-drop":
      return priceDropSpec(params as unknown as PriceDropParams);
  }
}

interface TemplateBody {
  template?: unknown;
  params?: unknown;
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

  let body: TemplateBody;
  try {
    body = (await req.json()) as TemplateBody;
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON" },
      { status: 400 },
    );
  }

  if (
    typeof body.template !== "string" ||
    !VALID_TEMPLATES.has(body.template)
  ) {
    return NextResponse.json(
      {
        error:
          "template must be one of: jewelry-reveal, youtube-intro, price-drop",
      },
      { status: 400 },
    );
  }
  const template = body.template as TemplateName;

  if (
    typeof body.params !== "object" ||
    body.params === null ||
    Array.isArray(body.params)
  ) {
    return NextResponse.json(
      { error: "params must be an object" },
      { status: 400 },
    );
  }
  const params = body.params as Record<string, unknown>;

  let spec: VideoSpec;
  try {
    spec = buildSpecForTemplate(template, params);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid template params",
        details: err instanceof Error ? err.message : "Unknown param error",
      },
      { status: 400 },
    );
  }

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

  const job = await createJob({
    composition: spec.compositionId,
    endpoint: "generate",
    callbackUrl,
    agentId,
    meta,
  });

  void runTemplateRender(job.id, spec, html);

  return NextResponse.json(
    {
      jobId: job.id,
      status: job.status,
      pollUrl: `/api/jobs/${job.id}`,
      composition: spec.compositionId,
      template,
      createdAt: job.createdAt,
      width: spec.width,
      height: spec.height,
    },
    { status: 202 },
  );
}

/**
 * Detached runner — mirrors /api/generate. Drives the job lifecycle by calling
 * /api/render-generated internally, then fires the optional webhook. Never throws.
 */
async function runTemplateRender(
  id: string,
  spec: VideoSpec,
  html: string,
): Promise<void> {
  await updateJob(id, {
    status: "restoring",
    startedAt: new Date().toISOString(),
  });

  const origin = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  try {
    await updateJob(id, { status: "rendering" });

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

    console.error(`[/api/render-template] job ${id} failed: ${message}`);

    if (failed) await fireCallback(failed, "render.failed");
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
