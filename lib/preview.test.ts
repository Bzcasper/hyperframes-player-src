import test from "node:test";
import assert from "node:assert/strict";

import {
  getPreviewHtml,
  getPreviewFile,
  getCompositionPreviewHtml,
  PREVIEW_BASE_PATH,
  PREVIEW_COMPOSITION_DIR,
  HYPERFRAMES_RUNTIME_URL,
  isPreviewRuntimeAliasPath,
} from "@/lib/preview";

test("preview constants point at the bundled composition", () => {
  assert.equal(PREVIEW_BASE_PATH, "/api/preview/");
  assert.match(PREVIEW_COMPOSITION_DIR, /public\/compositions\/[^/]+$/);
  assert.equal(HYPERFRAMES_RUNTIME_URL, "/api/runtime.js");
});

test("preview runtime aliases match the hyperframes runtime filenames", () => {
  assert.equal(isPreviewRuntimeAliasPath("hyperframe-runtime.js"), true);
  assert.equal(isPreviewRuntimeAliasPath("hyperframe.runtime.iife.js"), true);
  assert.equal(isPreviewRuntimeAliasPath("compositions/anything.html"), false);
});

test("getPreviewHtml injects the preview base and runtime script", async () => {
  const html = await getPreviewHtml();

  assert.match(html, /<base href="\/api\/preview\/">/);
  assert.match(
    html,
    /<script data-hyperframes-preview-runtime="1" src="\/api\/runtime\.js"><\/script>/,
  );
});

test("getPreviewHtml strips the raw runtime tag before reinjecting the pinned preview runtime", async () => {
  const html = await getPreviewHtml();
  const runtimeMatches = html.match(/\/api\/runtime\.js/g) ?? [];

  assert.equal(runtimeMatches.length, 1);
  assert.doesNotMatch(html, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@hyperframes\/core\/dist\/hyperframe\.runtime\.iife\.js"><\/script>/);
});

test("getCompositionPreviewHtml serves nested composition html with preview base and runtime", async () => {
  const html = await getCompositionPreviewHtml("compositions/ui-3d-reveal.html");

  assert.match(html, /<base href="\/api\/preview\/">/);
  assert.match(html, /data-composition-id="ui-3d-reveal"/);
  assert.match(html, /data-hyperframes-preview-runtime="1"/);
});

test("getPreviewFile serves static asset bytes with a content type", async () => {
  const file = await getPreviewFile("index.html");

  assert.equal(file.contentType, "text/html; charset=utf-8");
  assert.match(file.content.toString("utf8"), /<!doctype html>/i);
});

test("getPreviewFile rejects missing files", async () => {
  await assert.rejects(() => getPreviewFile("assets/missing.svg"), /not found/i);
});

test("getPreviewFile rejects path traversal", async () => {
  await assert.rejects(() => getPreviewFile("../package.json"), /invalid preview path/i);
});
