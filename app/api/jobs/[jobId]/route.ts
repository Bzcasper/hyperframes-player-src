import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { deleteJob, getJob } from "@/lib/job-store";

export const runtime = "nodejs";

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const { jobId } = await params;
  const job = await getJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const finished = job.status === "done" || job.status === "failed";
  return NextResponse.json({ ...job, finished });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  const deleted = await deleteJob(jobId);

  if (!deleted) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
