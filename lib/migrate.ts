/**
 * Database migration — run on every cold start via the migration endpoint.
 * Idempotent: uses CREATE TABLE IF NOT EXISTS.
 */

import { query } from "./db";

export async function runMigrations(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS hf_jobs (
      id TEXT PRIMARY KEY,
      composition TEXT NOT NULL,
      endpoint TEXT NOT NULL DEFAULT 'jobs',
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      duration_ms INTEGER,
      url TEXT,
      error TEXT,
      callback_url TEXT,
      agent_id TEXT,
      meta JSONB DEFAULT '{}'::jsonb
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS hf_spend (
      date_key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_hf_jobs_status_created ON hf_jobs(status, created_at);
  `);
}
