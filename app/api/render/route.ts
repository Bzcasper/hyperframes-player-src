import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { collectFiles, renderInSandbox } from "@/lib/sandbox";
import { PREVIEW_COMPOSITION_DIR } from "@/lib/preview";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  try {
    const files = await collectFiles(PREVIEW_COMPOSITION_DIR);
    const { mp4 } = await renderInSandbox(files);

    const blob = await put("renders/render.mp4", mp4, {
      contentType: "video/mp4",
      addRandomSuffix: true,
      allowOverwrite: true,
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
