import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

type OpenClawEvent =
  | "render.acknowledged"
  | "render.posted"
  | "render.failed-downstream";

type OpenClawWebhookBody = {
  event: OpenClawEvent;
  jobId: string;
  agentId: "openclaw";
  message: string;
  channelDelivered: boolean;
  timestamp: string;
};

function verifyToken(request: NextRequest): boolean {
  const expected = process.env.OPENCLAW_WEBHOOK_TOKEN;
  if (!expected) {
    // Dev mode — no token configured, skip auth
    return true;
  }

  const header = request.headers.get("X-OpenClaw-Token");
  if (!header) return false;

  const expectedBuf = Buffer.from(expected);
  const headerBuf = Buffer.from(header);

  if (expectedBuf.length !== headerBuf.length) return false;

  try {
    return timingSafeEqual(expectedBuf, headerBuf);
  } catch {
    return false;
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: "ok",
    endpoint: "openclaw-webhook",
    timestamp: new Date().toISOString(),
  });
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  if (!verifyToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as OpenClawWebhookBody;

    if (!body.jobId || !body.event) {
      return NextResponse.json(
        { error: "Missing required fields: jobId, event" },
        { status: 400 },
      );
    }

    // Dynamically import only when handler runs (avoids server init issues)
    const { getJob, updateJob } = await import("@/lib/job-store");

    const existing = await getJob(body.jobId);
    if (!existing) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const updatedMeta: Record<string, string> = {
      ...existing.meta,
      openclawAck: body.message,
      openclawEvent: body.event,
      openclawTs: body.timestamp,
      channelDelivered: String(body.channelDelivered),
    };

    await updateJob(body.jobId, { meta: updatedMeta });

    return NextResponse.json({ received: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to process webhook";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
