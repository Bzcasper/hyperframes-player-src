import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { renderInSandbox } from "@/lib/sandbox";

export const runtime = "nodejs";
export const maxDuration = 300;

interface UploadedFile {
  rel: string;
  content: Buffer;
}

/**
 * Real production render-job endpoint for Hermes / OpenClaw / mv-factory agents.
 *
 * Supports two modes (no mocks):
 * 1. Direct file upload (multipart: files[], optional audio)
 * 2. published_id → fetches the live published project from hyperframes.dev and renders it
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const publishedId = formData.get("published_id")?.toString();

    let files: UploadedFile[] = [];
    let audioFiles: { name: string; data: Buffer }[] = [];

    if (publishedId) {
      // === REAL MODE: Fetch live published project ===
      console.log(`[/api/render-job] Rendering published project: ${publishedId}`);

      const projectUrl = `https://hyperframes.dev/p/${publishedId}`;
      const res = await fetch(projectUrl, { redirect: "follow" });

      if (!res.ok) {
        throw new Error(`Failed to fetch published project ${publishedId}: ${res.status}`);
      }

      const html = await res.text();

      files.push({
        rel: "index.html",
        content: Buffer.from(html, "utf8"),
      });

      // Note: For full asset fidelity with published projects that reference external assets,
      // agents should upload the complete folder after `npx hyperframes publish`.
      // This path gives excellent results for self-contained published compositions.

    } else {
      // === Direct upload mode ===
      for (const [key, value] of formData.entries()) {
        if (value instanceof File) {
          const buffer = Buffer.from(await value.arrayBuffer());

          if (key === "audio" || value.name.toLowerCase().includes("audio")) {
            audioFiles.push({ name: value.name, data: buffer });
            continue;
          }

          let relPath = value.name;
          files.push({ rel: relPath, content: buffer });
        }
      }

      if (audioFiles.length > 0) {
        files.push({ rel: "audio.mp3", content: audioFiles[0].data });
      }
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "No files or published_id provided" }, { status: 400 });
    }

    console.log(`[/api/render-job] Rendering ${files.length} files (published_id=${publishedId || "upload"})`);

    const { mp4 } = await renderInSandbox(files);

    const blob = await put(`renders/${publishedId || "agent"}-${Date.now()}.mp4`, mp4, {
      access: "private",
      contentType: "video/mp4",
      addRandomSuffix: true,
    });

    return NextResponse.json({
      success: true,
      url: blob.url,
      filename: blob.pathname,
      size: mp4.length,
      mode: publishedId ? "published" : "upload",
      published_id: publishedId || null,
    });

  } catch (err) {
    console.error("[/api/render-job] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Remote render failed" },
      { status: 500 }
    );
  }
}
