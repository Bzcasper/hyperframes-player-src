/*
 * Internal render endpoint for dynamically generated compositions.
 *
 * Unlike /api/render (which collects a pre-bundled composition directory from
 * public/compositions/), this endpoint renders a composition whose index.html
 * was generated at request time from a VideoSpec. It mirrors the exact
 * lib/sandbox.ts usage of /api/render: build the composition file set, hand it
 * to renderInSandbox(), then upload the resulting MP4 to Vercel Blob.
 *
 * This route is internal (called by /api/generate) but is still protected by
 * the same RENDER_API_KEY Bearer check.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { put } from "@vercel/blob";
import { renderInSandbox } from "@/lib/sandbox";

export const runtime = "nodejs";
export const maxDuration = 300;

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

interface RenderGeneratedBody {
  compositionId?: unknown;
  html?: unknown;
  width?: unknown;
  height?: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RenderGeneratedBody;
  try {
    body = (await req.json()) as RenderGeneratedBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const compositionId =
    typeof body.compositionId === "string" ? body.compositionId.trim() : "";
  const html = typeof body.html === "string" ? body.html : "";

  if (!compositionId) {
    return NextResponse.json(
      { error: "compositionId is required" },
      { status: 400 },
    );
  }
  if (!html) {
    return NextResponse.json({ error: "html is required" }, { status: 400 });
  }

  try {
    // Mirror /api/render: hand an in-memory composition file set to the
    // sandbox renderer. The single index.html is all the generated
    // composition needs; assets are referenced by absolute URL.
    const { mp4 } = await renderInSandbox([
      { rel: "index.html", content: Buffer.from(html, "utf-8") },
    ]);

    const blob = await put(`generated/${compositionId}-${Date.now()}.mp4`, mp4, {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: true,
      allowOverwrite: true,
    });

    return NextResponse.json({ url: blob.url });
  } catch (err) {
    console.error("[/api/render-generated] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Render failed" },
      { status: 500 },
    );
  }
}
