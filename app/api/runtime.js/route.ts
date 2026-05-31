import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";

const CANDIDATES = [
  join(process.cwd(), "node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js"),
  join(process.cwd(), "../../node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js"),
];

let cached: Promise<string | null> | null = null;

async function loadRuntime(): Promise<string | null> {
  for (const path of CANDIDATES) {
    try {
      return await readFile(path, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return null;
}

export async function GET() {
  if (!cached) cached = loadRuntime();
  const runtime = await cached;

  if (!runtime) {
    return new NextResponse("hyperframes runtime not found", { status: 404 });
  }

  return new NextResponse(runtime, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
