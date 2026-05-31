/*
 * Template Library — Agent Quick-Start Specs
 *
 * Usage from Hermes skill / OpenClaw skill:
 *
 * POST /api/render-template
 * { "template": "jewelry-reveal", "params": { "compositionId": "ring-001",
 *   "productImageUrl": "https://...", "title": "14k Ring", "price": "$349" },
 *   "callbackUrl": "https://n8n.trapmoney.dpdns.org/webhook/video-done",
 *   "agentId": "hermes" }
 *
 * Available templates: "jewelry-reveal" | "youtube-intro" | "price-drop"
 *
 * Pure TypeScript — the only import is the VideoSpec/ClipSpec contract from
 * the composition builder. No Node.js I/O, no external packages. Each factory
 * returns a complete VideoSpec ready to pass into buildCompositionHtml().
 */

import type { ClipSpec, VideoSpec } from "@/lib/composition-builder";

const DEFAULT_BG = "#0a0a0f";
const GOLD = "#c9a84c";
const PURPLE = "#6c63ff";
const RED = "#ff4f6d";

export type JewelryRevealParams = {
  compositionId: string; // slug e.g. "ring-14k-gold-001"
  productImageUrl: string; // Cloudinary or any public URL
  title: string; // e.g. "14k Gold Diamond Ring"
  subtitle?: string; // e.g. "Estate Collection"
  price?: string; // e.g. "$349"
  accentColor?: string; // CSS color default "#c9a84c" (gold)
  bgColor?: string; // default "#0a0a0f"
  durationSecs?: number; // default 10
};

export type YouTubeIntroParams = {
  compositionId: string;
  channelName: string; // e.g. "@CreationcompanionDIY"
  episodeTitle: string;
  bgVideoUrl?: string; // optional background video URL
  accentColor?: string; // default "#6c63ff"
  bgColor?: string; // default "#0a0a0f"
  durationSecs?: number; // default 8
};

export type PriceDropParams = {
  compositionId: string;
  productName: string;
  originalPrice: string; // e.g. "$120"
  salePrice: string; // e.g. "$79"
  productImageUrl?: string;
  badgeText?: string; // e.g. "34% OFF"
  accentColor?: string; // default "#ff4f6d"
  bgColor?: string; // default "#0a0a0f"
  durationSecs?: number; // default 8
};

export function jewelryRevealSpec(p: JewelryRevealParams): VideoSpec {
  const duration = p.durationSecs ?? 10;
  const accent = p.accentColor ?? GOLD;
  const bgColor = p.bgColor ?? DEFAULT_BG;
  const clips: ClipSpec[] = [];

  clips.push({
    type: "image",
    id: "product",
    src: p.productImageUrl,
    start: 0,
    duration,
    track: 0,
    style: "width:1080px;height:1080px;object-fit:cover;opacity:0.85;",
  });

  clips.push({
    type: "text",
    id: "title",
    content: p.title,
    start: 1,
    duration: duration - 2,
    track: 1,
    style:
      "bottom:220px;left:0;right:0;text-align:center;color:#fff;font-size:64px;font-weight:900;text-shadow:0 2px 16px rgba(0,0,0,0.7);",
    animation: { entrance: "fade-up", exit: "fade-out" },
  });

  if (p.subtitle) {
    clips.push({
      type: "text",
      id: "subtitle",
      content: p.subtitle,
      start: 1.4,
      duration: duration - 2.5,
      track: 2,
      style: `bottom:170px;left:0;right:0;text-align:center;color:${accent};font-size:32px;font-weight:600;`,
      animation: { entrance: "fade-in", entranceDuration: 0.5 },
    });
  }

  if (p.price) {
    clips.push({
      type: "text",
      id: "price",
      content: p.price,
      start: 2,
      duration: duration - 2.5,
      track: 3,
      style: `bottom:100px;left:0;right:0;text-align:center;color:#fff;font-size:48px;font-weight:700;background:${accent};display:inline-block;padding:8px 32px;border-radius:8px;`,
      animation: { entrance: "scale-up", entranceDuration: 0.4 },
    });
  }

  return {
    compositionId: p.compositionId,
    width: 1080,
    height: 1080,
    totalDuration: duration,
    backgroundColor: bgColor,
    clips,
  };
}

export function youtubeIntroSpec(p: YouTubeIntroParams): VideoSpec {
  const duration = p.durationSecs ?? 8;
  const accent = p.accentColor ?? PURPLE;
  const bgColor = p.bgColor ?? DEFAULT_BG;
  const clips: ClipSpec[] = [];

  if (p.bgVideoUrl) {
    clips.push({
      type: "video",
      id: "bg",
      src: p.bgVideoUrl,
      start: 0,
      track: 0,
      volume: 0,
    });
  }

  clips.push({
    type: "text",
    id: "channel",
    content: p.channelName,
    start: 0.5,
    duration: duration - 1,
    track: 1,
    style: `top:280px;left:0;right:0;text-align:center;color:${accent};font-size:56px;font-weight:900;letter-spacing:4px;text-transform:uppercase;`,
    animation: { entrance: "slide-right", entranceDuration: 0.5 },
  });

  clips.push({
    type: "text",
    id: "episode",
    content: p.episodeTitle,
    start: 1.2,
    duration: duration - 2,
    track: 2,
    style:
      "top:380px;left:80px;right:80px;text-align:center;color:#fff;font-size:80px;font-weight:900;line-height:1.1;",
    animation: {
      entrance: "fade-up",
      exit: "fade-out",
      entranceDuration: 0.6,
      exitDuration: 0.5,
    },
  });

  return {
    compositionId: p.compositionId,
    width: 1920,
    height: 1080,
    totalDuration: duration,
    backgroundColor: bgColor,
    clips,
  };
}

export function priceDropSpec(p: PriceDropParams): VideoSpec {
  const duration = p.durationSecs ?? 8;
  const accent = p.accentColor ?? RED;
  const bgColor = p.bgColor ?? DEFAULT_BG;
  const clips: ClipSpec[] = [];

  if (p.productImageUrl) {
    clips.push({
      type: "image",
      id: "product",
      src: p.productImageUrl,
      start: 0,
      duration,
      track: 0,
      style: "width:1080px;height:1080px;object-fit:cover;opacity:0.4;",
    });
  }

  clips.push({
    type: "text",
    id: "name",
    content: p.productName,
    start: 0.5,
    duration: duration - 1,
    track: 1,
    style:
      "top:200px;left:0;right:0;text-align:center;color:#fff;font-size:56px;font-weight:700;",
    animation: { entrance: "fade-in" },
  });

  clips.push({
    type: "text",
    id: "original",
    content: p.originalPrice,
    start: 1,
    duration: duration - 1.5,
    track: 2,
    style:
      "top:310px;left:0;right:0;text-align:center;color:#888;font-size:64px;font-weight:400;text-decoration:line-through;",
    animation: { entrance: "fade-in", entranceDuration: 0.3 },
  });

  clips.push({
    type: "text",
    id: "sale",
    content: p.salePrice,
    start: 1.6,
    duration: duration - 2,
    track: 3,
    style: `top:390px;left:0;right:0;text-align:center;color:${accent};font-size:120px;font-weight:900;`,
    animation: { entrance: "scale-up", entranceDuration: 0.5 },
  });

  if (p.badgeText) {
    clips.push({
      type: "text",
      id: "badge",
      content: p.badgeText,
      start: 2.2,
      duration: duration - 2.5,
      track: 4,
      style: `top:540px;left:50%;transform:translateX(-50%);background:${accent};color:#fff;font-size:40px;font-weight:900;padding:12px 40px;border-radius:999px;white-space:nowrap;`,
      animation: { entrance: "scale-up", entranceDuration: 0.3 },
    });
  }

  return {
    compositionId: p.compositionId,
    width: 1080,
    height: 1080,
    totalDuration: duration,
    backgroundColor: bgColor,
    clips,
  };
}
