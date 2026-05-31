import { NextResponse } from "next/server";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const dir = join(process.cwd(), "public", "compositions");
    const entries = readdirSync(dir, { withFileTypes: true });
    const compositions = entries
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    return NextResponse.json({ compositions });
  } catch {
    return NextResponse.json({ compositions: [] });
  }
}
