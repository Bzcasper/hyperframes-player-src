/*
 * Status / Health API — read-only, no auth.
 *
 * GET /api/status
 *   Returns service health, current daily render spend, queue breakdown,
 *   the full endpoint catalog, and available template names. Agents can use
 *   this to confirm the service is live and check remaining render budget
 *   before submitting a job.
 */

import { NextResponse } from "next/server";
import { getSpendStatus } from "@/lib/spend-guard";
import { listJobs, type JobStatus } from "@/lib/job-store";

export const runtime = "nodejs";

const RENDERING_STATES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  "restoring",
  "preprocessing",
  "rendering",
  "encoding",
  "assembling",
  "uploading",
]);

export async function GET(): Promise<NextResponse> {
  const [spend, jobs] = await Promise.all([
    getSpendStatus(),
    listJobs(200),
  ]);

  let queued = 0;
  let rendering = 0;
  let done = 0;
  let failed = 0;
  let cancelled = 0;

  for (const job of jobs) {
    if (job.status === "queued") queued += 1;
    else if (RENDERING_STATES.has(job.status)) rendering += 1;
    else if (job.status === "done") done += 1;
    else if (job.status === "failed") failed += 1;
    else if (job.status === "cancelled") cancelled += 1;
  }

  return NextResponse.json({
    status: "ok",
    version: "1.0.0",
    spend: {
      rendersToday: spend.today,
      dailyLimit: spend.limit,
      resetAt: spend.resetAt,
    },
    queue: {
      total: jobs.length,
      queued,
      rendering,
      done,
      failed,
      cancelled,
    },
    endpoints: [
      "POST /api/jobs",
      "POST /api/generate",
      "POST /api/render-template",
      "POST /api/lint",
      "GET  /api/jobs",
      "GET  /api/jobs/:jobId",
      "GET  /api/compositions",
      "GET  /api/compositions/:name",
      "GET  /api/status",
    ],
    templates: ["jewelry-reveal", "youtube-intro", "price-drop"],
    stageMap: {
      queued:        { progressPct: 2,  upstreamState: "queued",        description: "Waiting for Sandbox slot" },
      restoring:     { progressPct: 6,  upstreamState: null,            description: "Vercel Sandbox snapshot restore (our layer)" },
      preprocessing: { progressPct: 18, upstreamState: "preprocessing", description: "Compile + extract videos + audio mix (Stages 1-3)" },
      rendering:     { progressPct: 72, upstreamState: "rendering",     description: "Puppeteer BeginFrame capture (Stage 4)" },
      encoding:      { progressPct: 88, upstreamState: "encoding",      description: "FFmpeg codec conversion (Stage 5)" },
      assembling:    { progressPct: 94, upstreamState: "assembling",    description: "Audio/video mux + MP4 faststart (Stage 6)" },
      uploading:     { progressPct: 97, upstreamState: null,            description: "Vercel Blob PUT (our layer)" },
      complete:      { progressPct: 100,upstreamState: "done",      description: "Artifact ready" },
      failed:        { progressPct: 0,  upstreamState: "failed",        description: "Render failed with diagnostics" },
      cancelled:     { progressPct: 0,  upstreamState: "cancelled",     description: "Aborted by system or spend guard" },
    },
    upstreamSource: "heygen-com/hyperframes packages/producer/src/services/renderOrchestrator.ts",
    renderPaths: ["sdr-parallel", "sdr-streaming", "hdr-hybrid", "hdr-sequential"],
    notes: "restoring and uploading are Vercel-template layers not in upstream producer",
  });
}
