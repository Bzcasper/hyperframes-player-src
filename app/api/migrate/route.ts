import { NextResponse } from "next/server";
import { runMigrations } from "@/lib/migrate";

export const runtime = "nodejs";

export async function GET() {
  try {
    await runMigrations();
    return NextResponse.json({ ok: true, migrated: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Migration failed";
    console.error("[migrate] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
