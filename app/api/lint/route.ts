/*
 * Composition Lint API — Pre-flight validation endpoint.
 *
 * POST /api/lint
 *   Content-Type: text/plain or application/json
 *   Body (text/plain): raw composition HTML string
 *   Body (application/json): { "html": "..." }
 *
 *   → 200 { valid: boolean, errors: string[], warnings: string[], checks: number }
 *
 * No auth required (read-only). Max body size: 512KB.
 * Agents can use this to verify generated HTML before submitting a render job,
 * avoiding wasted Sandbox spend on FATAL composition errors.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateCompositionHtml } from "@/lib/composition-builder";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 512 * 1024; // 512 KB

export async function POST(req: NextRequest): Promise<NextResponse> {
  const contentType = req.headers.get("content-type") ?? "";

  let html: string;

  if (contentType.includes("application/json")) {
    let raw: string;
    try {
      raw = await req.text();
    } catch {
      return NextResponse.json(
        { error: "Failed to read request body" },
        { status: 400 },
      );
    }

    if (Buffer.byteLength(raw, "utf-8") > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Request body exceeds 512 KB limit" },
        { status: 413 },
      );
    }

    let parsed: { html?: unknown };
    try {
      parsed = JSON.parse(raw) as { html?: unknown };
    } catch {
      return NextResponse.json(
        { error: "Body is not valid JSON" },
        { status: 400 },
      );
    }

    if (typeof parsed.html !== "string") {
      return NextResponse.json(
        { error: 'JSON body must contain a "html" string field' },
        { status: 400 },
      );
    }
    html = parsed.html;
  } else {
    // Treat as plain text — raw HTML.
    try {
      html = await req.text();
    } catch {
      return NextResponse.json(
        { error: "Failed to read request body" },
        { status: 400 },
      );
    }

    if (Buffer.byteLength(html, "utf-8") > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Request body exceeds 512 KB limit" },
        { status: 413 },
      );
    }
  }

  const errors = validateCompositionHtml(html);

  return NextResponse.json({
    valid: errors.length === 0,
    errors,
    warnings: [],
    checks: 5,
  });
}
