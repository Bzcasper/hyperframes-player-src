/*
 * Composition Metadata API — read-only, no auth.
 *
 * GET /api/compositions/:name
 *   Returns metadata for a pre-bundled composition directory, runs lint checks,
 *   and provides diagnostics about the HTML.
 *
 *   → 200 { valid, name, metadata, lintErrors, ... }
 *   → 404 { error: "Composition not found" }
 *
 * Agents use this to inspect a composition before submitting a render job.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { validateCompositionHtml } from "@/lib/composition-builder";
import { parseCompositionVariables } from "@/lib/composition-variables";
import type { CompositionVariable } from "@/lib/composition-variables";

export const runtime = "nodejs";

type CostTier = "low" | "medium" | "high" | "very-high";

type CostMeta = {
  hasShaders: boolean;
  hasVideo: boolean;
  clipCount: number;
  duration: number | null;
};

/**
 * Cost tier estimation mirroring upstream captureCost.ts logic.
 * Source: packages/producer/src/services/render/captureCost.ts lines 64-89
 */
function estimateCostTier(meta: CostMeta): CostTier {
  if (meta.hasShaders) return "very-high";
  if (meta.hasVideo && (meta.duration ?? 0) > 30) return "high";
  if (meta.hasVideo || meta.clipCount > 10) return "medium";
  return "low";
}

/** Estimated render minutes (p50) for each tier on a 4-vCPU Sandbox. */
const ESTIMATED_MINUTES: Record<CostTier, number> = {
  low: 1.5,
  medium: 2.5,
  high: 4.0,
  "very-high": 6.0,
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await params;

  // Safety: prevent path traversal (composition names are directory names).
  if (!/^[a-z0-9_-]+$/.test(name)) {
    return NextResponse.json(
      { error: "Invalid composition name" },
      { status: 400 },
    );
  }

  const filePath = join(process.cwd(), "public", "compositions", name, "index.html");

  if (!existsSync(filePath)) {
    return NextResponse.json(
      { error: "Composition not found" },
      { status: 404 },
    );
  }

  let html: string;
  try {
    html = readFileSync(filePath, "utf-8");
  } catch {
    return NextResponse.json(
      { error: "Failed to read composition file" },
      { status: 500 },
    );
  }

  const lintErrors = validateCompositionHtml(html);

  // Extract metadata from HTML via regex (fast, no DOM parser dependency).
  const compIdMatch = html.match(/data-composition-id="([^"]+)"/);
  const widthMatch = html.match(/data-width="(\d+)"/);
  const heightMatch = html.match(/data-height="(\d+)"/);
  const durationMatch = html.match(/data-duration="([\d.]+)"/);
  const timelineMatch = html.match(/window\.__timelines\["([^"]+)"\]/);

  const hasThreeJs = html.includes("three.min.js") || html.includes("three@");
  const hasAnimeJs = html.includes("animejs") || html.includes("anime.min.js");
  const hasGsap = html.includes("gsap.min.js") || html.includes("gsap@");

  const clipCount = (html.match(/\bclip\b/g) || []).length;
  const videoClipCount = (html.match(/<video[\s>]/g) || []).length;
  const audioClipCount = (html.match(/<audio[\s>]/g) || []).length;
  const imgClipCount = (html.match(/<img[\s>]/g) || []).length;

  const hasAudio =
    audioClipCount > 0 || html.includes('type="audio"');
  const hasVideo =
    videoClipCount > 0 || html.includes('type="video"');

  // Count script blocks and timeline keys.
  const scriptBlocks = html.match(/<script[^>]*>/g)?.length ?? 0;

  // Total duration from the trailing tl.to({}, { duration: ... }) pattern.
  const totalDurationMatch = html.match(/tl\.to\(\{\},\s*\{\s*duration:\s*([\d.]+)\s*\}\s*,/);
  const totalDuration = totalDurationMatch
    ? Number(totalDurationMatch[1])
    : durationMatch
      ? Number(durationMatch[1])
      : null;

  const costMeta: CostMeta = {
    hasShaders: hasThreeJs,
    hasVideo,
    clipCount,
    duration: totalDuration,
  };
  const costTier = estimateCostTier(costMeta);

  const variables: CompositionVariable[] = parseCompositionVariables(html);

  return NextResponse.json({
    name,
    valid: lintErrors.length === 0,
    metadata: {
      compositionId: compIdMatch?.[1] ?? null,
      width: widthMatch ? Number(widthMatch[1]) : null,
      height: heightMatch ? Number(heightMatch[1]) : null,
      duration: durationMatch ? Number(durationMatch[1]) : totalDuration,
      hasShaders: hasThreeJs,
      hasAudio,
      hasVideo,
      hasGsap,
      hasAnimeJs,
    },
    clips: {
      total: clipCount,
      video: videoClipCount,
      audio: audioClipCount,
      image: imgClipCount,
    },
    scripts: scriptBlocks,
    lintErrors,
    timelineId: timelineMatch?.[1] ?? null,
    costTier,
    estimatedRenderMinutes: ESTIMATED_MINUTES[costTier],
    renderPath: hasThreeJs ? "hdr" : "sdr",
    variables,
    hasVariables: variables.length > 0,
  });
}
