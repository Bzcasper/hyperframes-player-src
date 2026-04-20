import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { join } from "node:path";
import { renderInSandbox } from "@/lib/sandbox";

export const runtime = "nodejs";
export const maxDuration = 300;

const COMPOSITION_DIR = join(
  process.cwd(),
  "public",
  "compositions",
  "product-promo",
);
const COMPOSITION_ENTRY = "index.html";

export async function POST() {
  try {
    const { mp4 } = await renderInSandbox(COMPOSITION_DIR, COMPOSITION_ENTRY);

    const blob = await put("renders/render.mp4", mp4, {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: true,
    });

    return NextResponse.json({ url: blob.url });
  } catch (err) {
    console.error("[/api/render] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Render failed" },
      { status: 500 },
    );
  }
}
