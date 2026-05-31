/*
 * Spend Guard — daily render rate limiter backed by Postgres.
 * Counters are keyed by UTC date and persist across cold starts.
 */

import { queryOne, execute } from "./db";

const DEFAULT_MAX_RENDERS_PER_DAY = 20;
const MAX_RENDERS_ENV_VAR = "MAX_RENDERS_PER_DAY";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextUtcMidnightIso(): string {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  );
  return next.toISOString();
}

function resolveLimit(): number {
  const raw = process.env[MAX_RENDERS_ENV_VAR];
  if (raw === undefined) return DEFAULT_MAX_RENDERS_PER_DAY;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 0 ? DEFAULT_MAX_RENDERS_PER_DAY : parsed;
}

export interface SpendGuardResult {
  allowed: boolean;
  count: number;
  limit: number;
  resetAt: string;
  message?: string;
}

/**
 * Check whether another render is allowed under the daily limit.
 * Uses a Postgres upsert so the count is atomic and persistent.
 */
export async function checkSpendLimit(): Promise<SpendGuardResult> {
  const limit = resolveLimit();
  const resetAt = nextUtcMidnightIso();
  const key = todayKey();

  // Atomic increment — insert if not exists, else increment.
  await execute(
    `INSERT INTO hf_spend (date_key, count, window_start)
     VALUES ($1, 1, NOW())
     ON CONFLICT (date_key) DO UPDATE SET count = hf_spend.count + 1`,
    [key],
  );

  const row = await queryOne<{ count: number }>(
    "SELECT count FROM hf_spend WHERE date_key = $1",
    [key],
  );

  const count = row?.count ?? 0;

  if (count > limit) {
    return {
      allowed: false,
      count,
      limit,
      resetAt,
      message: `Daily render limit reached. Set ${MAX_RENDERS_ENV_VAR} env var to adjust.`,
    };
  }

  return { allowed: true, count, limit, resetAt };
}

/**
 * Increment today's counter unconditionally.
 */
export async function recordRender(): Promise<void> {
  const key = todayKey();
  await execute(
    `INSERT INTO hf_spend (date_key, count, window_start)
     VALUES ($1, 1, NOW())
     ON CONFLICT (date_key) DO UPDATE SET count = hf_spend.count + 1`,
    [key],
  );
}

export async function getSpendStatus(): Promise<{
  today: number;
  limit: number;
  limitEnvVar: string;
  resetAt: string;
}> {
  const limit = resolveLimit();
  const key = todayKey();
  const resetAt = nextUtcMidnightIso();

  const row = await queryOne<{ count: number }>(
    "SELECT count FROM hf_spend WHERE date_key = $1",
    [key],
  );

  return {
    today: row?.count ?? 0,
    limit,
    limitEnvVar: MAX_RENDERS_ENV_VAR,
    resetAt,
  };
}
