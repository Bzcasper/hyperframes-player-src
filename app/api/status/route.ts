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
  "rendering",
  "encoding",
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

  for (const job of jobs) {
    if (job.status === "queued") queued += 1;
    else if (RENDERING_STATES.has(job.status)) rendering += 1;
    else if (job.status === "done") done += 1;
    else if (job.status === "failed") failed += 1;
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
    },
    endpoints: [
      "POST /api/jobs",
      "POST /api/generate",
      "POST /api/render-template",
      "GET  /api/jobs",
      "GET  /api/jobs/:jobId",
      "GET  /api/compositions",
      "GET  /api/status",
    ],
    templates: ["jewelry-reveal", "youtube-intro", "price-drop"],
  });
}
