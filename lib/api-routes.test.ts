import test from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests for new API routes.
 * These test the route handlers by simulating HTTP requests.
 * We import the handler functions directly and call them with mock request objects.
 */

/* ─── /api/lint ─── */

test("/api/lint accepts plain text HTML body", async () => {
  const { POST } = await import("@/app/api/lint/route");
  const req = new Request("http://localhost:3000/api/lint", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: `<html><body><div data-composition-id="test"></div></body></html>`,
  });
  const res = await POST(req as never);
  const body = (await res.json()) as { valid: boolean; errors: string[]; checks: number };
  assert.equal(res.status, 200);
  assert.ok(typeof body.valid === "boolean");
  assert.ok(Array.isArray(body.errors));
  assert.equal(body.checks, 5);
});

test("/api/lint accepts JSON body with html field", async () => {
  const { POST } = await import("@/app/api/lint/route");
  const req = new Request("http://localhost:3000/api/lint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: `<html><body><div data-composition-id="test"></div></body></html>` }),
  });
  const res = await POST(req as never);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { valid: boolean };
  assert.equal(typeof body.valid, "boolean");
});

test("/api/lint returns errors for invalid HTML", async () => {
  const { POST } = await import("@/app/api/lint/route");
  const req = new Request("http://localhost:3000/api/lint", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: `<html></html>`,
  });
  const res = await POST(req as never);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { valid: boolean; errors: string[] };
  assert.equal(body.valid, false);
  assert.ok(body.errors.length >= 1);
});

test("/api/lint rejects missing html field in JSON", async () => {
  const { POST } = await import("@/app/api/lint/route");
  const req = new Request("http://localhost:3000/api/lint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  const res = await POST(req as never);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /html.*string field/i);
});

test("/api/lint rejects oversized body (over 512KB)", async () => {
  const { POST } = await import("@/app/api/lint/route");
  //  513 KB of 'x' = 525312 bytes
  const bigBody = "A".repeat(525_312);
  const req = new Request("http://localhost:3000/api/lint", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: bigBody,
  });
  const res = await POST(req as never);
  assert.equal(res.status, 413);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /512 KB/i);
});

/* ─── /api/compositions/:name ─── */

test("/api/compositions/vercel-intro returns metadata", async () => {
  const { GET } = await import("@/app/api/compositions/[name]/route");
  const req = new Request("http://localhost:3000/api/compositions/vercel-intro");
  const res = await GET(req as never, {
    params: Promise.resolve({ name: "vercel-intro" }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    name: string;
    valid: boolean;
    metadata: Record<string, unknown>;
    lintErrors: string[];
    timelineId: string | null;
  };
  assert.equal(body.name, "vercel-intro");
  assert.equal(body.metadata.compositionId, "vercel-intro");
  assert.equal(body.metadata.width, 1920);
  assert.equal(body.metadata.height, 1080);
  assert.equal(body.metadata.duration, 11.05);
  assert.equal(body.metadata.hasShaders, true);
  assert.equal(body.metadata.hasGsap, true);
  assert.equal(body.timelineId, "vercel-intro");
});

test("/api/compositions/glow-card returns metadata", async () => {
  const { GET } = await import("@/app/api/compositions/[name]/route");
  const req = new Request("http://localhost:3000/api/compositions/glow-card");
  const res = await GET(req as never, {
    params: Promise.resolve({ name: "glow-card" }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    name: string;
    valid: boolean;
    metadata: { compositionId: string | null; width: number | null; height: number | null };
    clips: { total: number };
    lintErrors: string[];
  };
  assert.equal(body.name, "glow-card");
  assert.equal(body.metadata.compositionId, "main");
  assert.equal(body.metadata.width, 1920);
  assert.equal(body.metadata.height, 1080);
  assert.ok(body.clips.total >= 23, `expected >= 23 clips, got ${body.clips.total}`);
  // glow-card uses a non-standard composition-id "main" but timeline matches
  assert.ok(Array.isArray(body.lintErrors));
});

test("/api/compositions/nonexistent returns 404", async () => {
  const { GET } = await import("@/app/api/compositions/[name]/route");
  const req = new Request("http://localhost:3000/api/compositions/nonexistent");
  const res = await GET(req as never, {
    params: Promise.resolve({ name: "nonexistent" }),
  });
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /not found/i);
});

test("/api/compositions rejects path traversal", async () => {
  const { GET } = await import("@/app/api/compositions/[name]/route");
  const req = new Request("http://localhost:3000/api/compositions/../../../etc/passwd");
  const res = await GET(req as never, {
    params: Promise.resolve({ name: "../../../etc/passwd" }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /invalid/i);
});
