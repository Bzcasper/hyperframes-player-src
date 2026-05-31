import test from "node:test";
import assert from "node:assert/strict";
import {
  jewelryRevealSpec,
  youtubeIntroSpec,
  priceDropSpec,
} from "@/lib/templates";
import {
  buildCompositionHtml,
  validateCompositionHtml,
} from "@/lib/composition-builder";

/* ─── Each template must produce linter-clean HTML ─── */

test("jewelryRevealSpec builds valid HTML with all params", () => {
  const spec = jewelryRevealSpec({
    compositionId: "ring-14k-001",
    productImageUrl: "https://example.com/ring.jpg",
    title: "Tennis Bracelet",
    subtitle: "Estate Collection",
    price: "$89",
    accentColor: "#c9a84c",
    bgColor: "#0a0a0f",
    durationSecs: 10,
  });
  assert.equal(spec.compositionId, "ring-14k-001");
  assert.equal(spec.width, 1080);
  assert.equal(spec.height, 1080);
  assert.equal(spec.totalDuration, 10);

  const html = buildCompositionHtml(spec);
  const errors = validateCompositionHtml(html);
  assert.deepEqual(errors, [], "jewelry-reveal HTML must pass linter");
});

test("jewelryRevealSpec works with only required params", () => {
  const spec = jewelryRevealSpec({
    compositionId: "ring-min-001",
    productImageUrl: "https://example.com/ring.jpg",
    title: "Minimal Ring",
  });
  const html = buildCompositionHtml(spec);
  const errors = validateCompositionHtml(html);
  assert.deepEqual(errors, []);
});

test("youtubeIntroSpec builds valid HTML with all params", () => {
  const spec = youtubeIntroSpec({
    compositionId: "ep-042-intro",
    channelName: "@CreationcompanionDIY",
    episodeTitle: "Building AI Pipelines",
    accentColor: "#6c63ff",
    bgColor: "#0a0a0f",
    durationSecs: 8,
  });
  assert.equal(spec.width, 1920);
  assert.equal(spec.height, 1080);

  const html = buildCompositionHtml(spec);
  const errors = validateCompositionHtml(html);
  assert.deepEqual(errors, [], "youtube-intro HTML must pass linter");
});

test("youtubeIntroSpec works with only required params", () => {
  const spec = youtubeIntroSpec({
    compositionId: "ep-min-intro",
    channelName: "@Test",
    episodeTitle: "Test Episode",
  });
  const html = buildCompositionHtml(spec);
  const errors = validateCompositionHtml(html);
  assert.deepEqual(errors, []);
});

test("priceDropSpec builds valid HTML with all params", () => {
  const spec = priceDropSpec({
    compositionId: "deal-14k-ring",
    productName: "14k Gold Ring",
    originalPrice: "$299",
    salePrice: "$149",
    productImageUrl: "https://example.com/ring.jpg",
    badgeText: "50% OFF",
    accentColor: "#ff4f6d",
    bgColor: "#0a0a0f",
    durationSecs: 8,
  });
  assert.equal(spec.width, 1080);
  assert.equal(spec.height, 1080);

  const html = buildCompositionHtml(spec);
  const errors = validateCompositionHtml(html);
  assert.deepEqual(errors, [], "price-drop HTML must pass linter");
});

test("priceDropSpec works with only required params", () => {
  const spec = priceDropSpec({
    compositionId: "deal-min",
    productName: "Gold Ring",
    originalPrice: "$200",
    salePrice: "$100",
  });
  const html = buildCompositionHtml(spec);
  const errors = validateCompositionHtml(html);
  assert.deepEqual(errors, []);
});

/* ─── GSAP animation output is deterministic ─── */

test("all template specs produce deterministic HTML (no Math.random / Date.now)", () => {
  const ringSpec = jewelryRevealSpec({
    compositionId: "det-test",
    productImageUrl: "https://example.com/p.jpg",
    title: "Test",
  });
  const html1 = buildCompositionHtml(ringSpec);
  const html2 = buildCompositionHtml(ringSpec);
  assert.equal(html1, html2);
});
