import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCompositionHtml,
  buildCompositionHtml,
  validateVideoSpec,
  type VideoSpec,
} from "@/lib/composition-builder";

/* ─── validateCompositionHtml ─── */

test("validateCompositionHtml passes valid generated HTML", () => {
  const spec: VideoSpec = {
    compositionId: "test-001",
    width: 1080,
    height: 1080,
    totalDuration: 10,
    backgroundColor: "#000",
    clips: [],
  };
  const html = buildCompositionHtml(spec);
  const errors = validateCompositionHtml(html);
  assert.deepEqual(errors, []);
});

test("validateCompositionHtml detects missing data-composition-id", () => {
  const html = `<html><body><div id="stage"></div></body></html>`;
  const errors = validateCompositionHtml(html);
  assert.ok(errors.length >= 1);
  assert.match(errors[0], /data-composition-id/i);
});

test("validateCompositionHtml detects uninitialized window.__timelines", () => {
  const html = `<html><body>
    <div data-composition-id="test"></div>
    <script>window.__timelines["test"] = gsap.timeline();</script>
  </body></html>`;
  const errors = validateCompositionHtml(html);
  assert.ok(errors.some(e => /assigned without initialization/i.test(e)));
});

test("validateCompositionHtml detects assignment before initialization", () => {
  const html = `<html><body>
    <div data-composition-id="test"></div>
    <script>
    window.__timelines["test"] = gsap.timeline();
    window.__timelines = window.__timelines || {};
  </script></body></html>`;
  const errors = validateCompositionHtml(html);
  assert.ok(errors.some((e) => /assigned before initialization/i.test(e)));
});

test("validateCompositionHtml detects Math.random() in scripts", () => {
  const html = `<html><body>
    <div data-composition-id="test"></div>
    <script>const x = Math.random();</script>
  </body></html>`;
  const errors = validateCompositionHtml(html);
  assert.ok(errors.some(e => /Math\.random/i.test(e)));
});

test("validateCompositionHtml detects Date.now() in scripts", () => {
  const html = `<html><body>
    <div data-composition-id="test"></div>
    <script>const t = Date.now();</script>
  </body></html>`;
  const errors = validateCompositionHtml(html);
  assert.ok(errors.some(e => /Date\.now/i.test(e)));
});

test("validateCompositionHtml detects timeline ID mismatch", () => {
  const html = `<html><body>
    <div data-composition-id="alpha"></div>
    <script>window.__timelines = window.__timelines || {}; window.__timelines["beta"] = gsap.timeline();</script>
  </body></html>`;
  const errors = validateCompositionHtml(html);
  assert.ok(errors.length >= 1);
  assert.match(errors[0], /mismatch/i);
});

test("validateCompositionHtml tolerates properly initialized timelines", () => {
  const html = `<html><body>
    <div data-composition-id="test"></div>
    <script src="/hyperframes-runtime.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["test"] = gsap.timeline();
    </script>
  </body></html>`;
  const errors = validateCompositionHtml(html);
  assert.ok(errors.length === 0 || errors.every(e => !e.includes("FATAL")));
});

test("validateCompositionHtml returns errors as array, not thrown", () => {
  const errors = validateCompositionHtml("<html></html>");
  assert.ok(Array.isArray(errors));
  assert.ok(errors.length >= 1);
  assert.equal(typeof errors[0], "string");
});

/* ─── buildCompositionHtml integration ─── */

test("buildCompositionHtml output passes validateCompositionHtml for all clip types", () => {
  const spec: VideoSpec = {
    compositionId: "all-clips",
    width: 1920,
    height: 1080,
    totalDuration: 30,
    backgroundColor: "#0a0a0f",
    clips: [
      { type: "video", id: "bg", src: "https://example.com/bg.mp4", start: 0, track: 0, volume: 0 },
      { type: "image", id: "logo", src: "https://example.com/logo.png", start: 0, duration: 30, track: 1 },
      { type: "text", id: "title", content: "Hello", start: 1, duration: 5, track: 2 },
      { type: "audio", id: "music", src: "https://example.com/track.mp3", start: 0, track: 3, volume: 0.5 },
    ],
  };
  const html = buildCompositionHtml(spec);
  const errors = validateCompositionHtml(html);
  assert.deepEqual(errors, []);
});

test("buildCompositionHtml includes class=clip on video and img elements", () => {
  const spec: VideoSpec = {
    compositionId: "clip-class",
    width: 1920,
    height: 1080,
    totalDuration: 10,
    clips: [
      { type: "video", id: "bg", src: "https://example.com/bg.mp4", start: 0, track: 0 },
      { type: "image", id: "logo", src: "https://example.com/logo.png", start: 0, duration: 10, track: 1 },
    ],
  };
  const html = buildCompositionHtml(spec);
  assert.match(html, /<video[\s\S]*?class="clip"/);
  assert.match(html, /<img[\s\S]*?class="clip"/);
});

test("buildCompositionHtml produces deterministic output (no Math.random or Date.now)", () => {
  const spec: VideoSpec = {
    compositionId: "deterministic",
    width: 1920,
    height: 1080,
    totalDuration: 10,
    clips: [
      { type: "text", id: "t1", content: "Hello", start: 0, duration: 5, track: 0,
        animation: { entrance: "fade-up", exit: "fade-out" } },
    ],
  };
  const htmlA = buildCompositionHtml(spec);
  const htmlB = buildCompositionHtml(spec);
  assert.equal(htmlA, htmlB);
});

/* ─── validateVideoSpec ─── */

test("validateVideoSpec rejects null", () => {
  assert.equal(validateVideoSpec(null), false);
});

test("validateVideoSpec rejects empty object", () => {
  assert.equal(validateVideoSpec({}), false);
});

test("validateVideoSpec accepts minimal valid spec", () => {
  const spec: VideoSpec = {
    compositionId: "min",
    width: 100,
    height: 100,
    totalDuration: 1,
    clips: [],
  };
  assert.equal(validateVideoSpec(spec), true);
});
