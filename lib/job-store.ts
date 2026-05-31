import { randomUUID } from "node:crypto";
import { query, queryOne, execute } from "./db";

export type JobStatus =
  | "queued"         // waiting for Sandbox slot
  | "restoring"      // Vercel Sandbox snapshot restore (~100ms, our layer)
  | "preprocessing"  // compile + extract videos + audio mix (Stages 1-3)
  | "rendering"      // Puppeteer BeginFrame capture (Stage 4, ~90s)
  | "encoding"       // FFmpeg codec conversion (Stage 5)
  | "assembling"     // audio/video mux + MP4 faststart (Stage 6)
  | "uploading"      // Vercel Blob PUT (our layer)
  | "complete"       // artifact ready, url populated
  | "failed"         // error, error field populated
  | "cancelled";     // aborted by system or spend guard

export type JobEndpoint = "jobs" | "generate";

export type RenderJob = {
  id: string;
  composition: string;
  endpoint: JobEndpoint;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  url: string | null;
  error: string | null;
  callbackUrl: string | null;
  agentId: string | null;
  meta: Record<string, string>;
};

function rowToJob(row: {
  id: string;
  composition: string;
  endpoint: string;
  status: string;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  duration_ms: number | null;
  url: string | null;
  error: string | null;
  callback_url: string | null;
  agent_id: string | null;
  meta: Record<string, string>;
}): RenderJob {
  return {
    id: row.id,
    composition: row.composition,
    endpoint: row.endpoint as JobEndpoint,
    status: row.status as JobStatus,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    durationMs: row.duration_ms,
    url: row.url,
    error: row.error,
    callbackUrl: row.callback_url,
    agentId: row.agent_id,
    meta: row.meta ?? {},
  };
}

/**
 * UI progress percentage lookup. Mirrors upstream renderOrchestrator.ts stage timing.
 * restoring and uploading are Vercel-template layers (not in upstream producer).
 */
export const stageProgressPct: Record<JobStatus, number> = {
  queued:        2,
  restoring:     6,
  preprocessing: 18,
  rendering:     72,
  encoding:      88,
  assembling:    94,
  uploading:     97,
  complete:      100,
  failed:        0,
  cancelled:     0,
};

/**
 * Cancel a job — sets status to "cancelled" and records completion time.
 * Returns the updated job or undefined if the job does not exist.
 */
export async function cancelJob(
  id: string,
): Promise<RenderJob | undefined> {
  return updateJob(id, {
    status: "cancelled",
    completedAt: new Date().toISOString(),
  });
}

export async function createJob(params: {
  composition: string;
  endpoint?: JobEndpoint;
  callbackUrl?: string;
  agentId?: string;
  meta?: Record<string, string>;
}): Promise<RenderJob> {
  const id = randomUUID();
  const now = new Date().toISOString();

  await execute(
    `INSERT INTO hf_jobs (id, composition, endpoint, status, created_at, callback_url, agent_id, meta)
     VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7)`,
    [
      id,
      params.composition,
      params.endpoint ?? "jobs",
      now,
      params.callbackUrl ?? null,
      params.agentId ?? null,
      JSON.stringify(params.meta ?? {}),
    ],
  );

  return {
    id,
    composition: params.composition,
    endpoint: params.endpoint ?? "jobs",
    status: "queued",
    createdAt: now,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    url: null,
    error: null,
    callbackUrl: params.callbackUrl ?? null,
    agentId: params.agentId ?? null,
    meta: params.meta ?? {},
  };
}

export async function getJob(
  id: string,
): Promise<RenderJob | undefined> {
  const row = await queryOne<{
    id: string;
    composition: string;
    endpoint: string;
    status: string;
    created_at: Date;
    started_at: Date | null;
    completed_at: Date | null;
    duration_ms: number | null;
    url: string | null;
    error: string | null;
    callback_url: string | null;
    agent_id: string | null;
    meta: Record<string, string>;
  }>("SELECT * FROM hf_jobs WHERE id = $1", [id]);
  return row ? rowToJob(row) : undefined;
}

export async function updateJob(
  id: string,
  patch: Partial<RenderJob>,
): Promise<RenderJob | undefined> {
  const existing = await getJob(id);
  if (!existing) return undefined;

  const updated = { ...existing, ...patch, id: existing.id };

  await execute(
    `UPDATE hf_jobs SET
       status = $1, started_at = $2, completed_at = $3, duration_ms = $4,
       url = $5, error = $6
     WHERE id = $7`,
    [
      updated.status,
      updated.startedAt,
      updated.completedAt,
      updated.durationMs,
      updated.url,
      updated.error,
      id,
    ],
  );

  return updated;
}

export async function listJobs(limit = 50): Promise<RenderJob[]> {
  const rows = await query<{
    id: string;
    composition: string;
    endpoint: string;
    status: string;
    created_at: Date;
    started_at: Date | null;
    completed_at: Date | null;
    duration_ms: number | null;
    url: string | null;
    error: string | null;
    callback_url: string | null;
    agent_id: string | null;
    meta: Record<string, string>;
  }>(
    "SELECT * FROM hf_jobs ORDER BY created_at DESC LIMIT $1",
    [limit],
  );
  return rows.map(rowToJob);
}

export async function deleteJob(id: string): Promise<boolean> {
  const count = await execute("DELETE FROM hf_jobs WHERE id = $1", [id]);
  return count > 0;
}
