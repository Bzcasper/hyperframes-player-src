/**
 * HyperFrames composition builder.
 *
 * Pure TypeScript — no Node.js I/O, no external packages. Takes a declarative
 * VideoSpec (the agent-facing contract) and produces a valid HyperFrames
 * index.html string with optional GSAP text animations.
 *
 * The HTML is built by hand as a template literal (NOT via
 * generateHyperframesHtml) so we keep precise control over the stage layout,
 * data-* timing attributes, and deterministic numeric GSAP positions.
 */

export type TextAnimation = {
  entrance?: "fade-up" | "fade-in" | "slide-left" | "slide-right" | "scale-up";
  exit?: "fade-out" | "slide-left" | "slide-right" | "fade-down";
  entranceDuration?: number; // seconds, default 0.4
  exitDuration?: number; // seconds, default 0.3
};

export type ClipSpec =
  | {
      type: "video";
      id: string;
      src: string;
      start: number;
      duration?: number;
      track: number;
      volume?: number;
      mediaStart?: number;
    }
  | {
      type: "image";
      id: string;
      src: string;
      start: number;
      duration: number;
      track: number;
      style?: string;
    }
  | {
      type: "audio";
      id: string;
      src: string;
      start: number;
      duration?: number;
      track: number;
      volume?: number;
    }
  | {
      type: "text";
      id: string;
      content: string;
      start: number;
      duration: number;
      track: number;
      style?: string;
      animation?: TextAnimation;
    };

export type VideoSpec = {
  compositionId: string;
  width: number;
  height: number;
  totalDuration: number;
  backgroundColor?: string;
  clips: ClipSpec[];
  globalStyles?: string;
};

const COMPOSITION_ID_RE = /^[a-z0-9-]+$/;
const CLIP_TYPES = new Set(["video", "image", "audio", "text"]);
const DEFAULT_ENTRANCE_DURATION = 0.4;
const DEFAULT_EXIT_DURATION = 0.3;

/**
 * Runtime type guard for VideoSpec. Performs manual structural checks only
 * (no zod). Returns false on any structural problem; the caller is expected to
 * throw with its own context.
 */
export function validateVideoSpec(spec: unknown): spec is VideoSpec {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    return false;
  }
  const s = spec as Record<string, unknown>;

  if (typeof s.compositionId !== "string") return false;
  if (typeof s.width !== "number" || typeof s.height !== "number") return false;
  if (typeof s.totalDuration !== "number") return false;
  if (
    s.backgroundColor !== undefined &&
    typeof s.backgroundColor !== "string"
  ) {
    return false;
  }
  if (s.globalStyles !== undefined && typeof s.globalStyles !== "string") {
    return false;
  }
  if (!Array.isArray(s.clips)) return false;

  for (const raw of s.clips) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return false;
    }
    const c = raw as Record<string, unknown>;
    if (typeof c.type !== "string" || !CLIP_TYPES.has(c.type)) return false;
    if (typeof c.id !== "string") return false;
    if (typeof c.start !== "number") return false;
    if (typeof c.track !== "number") return false;

    if (c.type === "text") {
      if (typeof c.content !== "string") return false;
      if (typeof c.duration !== "number") return false;
    } else if (c.type === "image") {
      if (typeof c.src !== "string") return false;
      if (typeof c.duration !== "number") return false;
    } else {
      // video or audio
      if (typeof c.src !== "string") return false;
      if (c.duration !== undefined && typeof c.duration !== "number") {
        return false;
      }
    }
  }

  return true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Effective end time of a clip for overlap detection. Clips without an explicit
 * duration (video/audio) are treated as running to the end of the composition.
 */
function clipEnd(clip: ClipSpec, totalDuration: number): number {
  const duration =
    "duration" in clip && typeof clip.duration === "number"
      ? clip.duration
      : undefined;
  return duration !== undefined ? clip.start + duration : totalDuration;
}

function assertValid(spec: VideoSpec): void {
  if (!COMPOSITION_ID_RE.test(spec.compositionId)) {
    throw new TypeError(
      `compositionId must match /^[a-z0-9-]+$/ (got "${spec.compositionId}")`,
    );
  }
  if (!Number.isInteger(spec.width) || spec.width <= 0) {
    throw new TypeError(`width must be a positive integer (got ${spec.width})`);
  }
  if (!Number.isInteger(spec.height) || spec.height <= 0) {
    throw new TypeError(
      `height must be a positive integer (got ${spec.height})`,
    );
  }
  if (!(spec.totalDuration > 0)) {
    throw new TypeError(
      `totalDuration must be greater than 0 (got ${spec.totalDuration})`,
    );
  }

  const seen = new Set<string>();
  for (const clip of spec.clips) {
    if (seen.has(clip.id)) {
      throw new TypeError(`duplicate clip id "${clip.id}"`);
    }
    seen.add(clip.id);

    if (clip.type === "text" && typeof clip.duration !== "number") {
      throw new TypeError(`text clip "${clip.id}" must have a duration`);
    }
    if (clip.type === "image" && typeof clip.duration !== "number") {
      throw new TypeError(`image clip "${clip.id}" must have a duration`);
    }
  }

  // No two clips on the same track may overlap in time.
  const byTrack = new Map<number, ClipSpec[]>();
  for (const clip of spec.clips) {
    const list = byTrack.get(clip.track) ?? [];
    list.push(clip);
    byTrack.set(clip.track, list);
  }

  for (const [track, clips] of byTrack) {
    const sorted = [...clips].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const prevEnd = clipEnd(prev, spec.totalDuration);
      if (curr.start < prevEnd) {
        throw new TypeError(
          `clips "${prev.id}" and "${curr.id}" overlap on track ${track}`,
        );
      }
    }
  }
}

function renderClip(clip: ClipSpec): string {
  switch (clip.type) {
    case "video": {
      const attrs = [
        `id="${escapeAttr(clip.id)}"`,
        `class="clip"`,
        `data-start="${clip.start}"`,
        clip.duration !== undefined ? `data-duration="${clip.duration}"` : "",
        `data-track-index="${clip.track}"`,
        clip.mediaStart !== undefined
          ? `data-media-start="${clip.mediaStart}"`
          : "",
        clip.volume !== undefined ? `data-volume="${clip.volume}"` : "",
        `src="${escapeAttr(clip.src)}"`,
      ]
        .filter(Boolean)
        .join("\n        ");
      return `      <video\n        ${attrs}\n      ></video>`;
    }
    case "image": {
      const attrs = [
        `id="${escapeAttr(clip.id)}"`,
        `class="clip"`,
        `data-start="${clip.start}"`,
        `data-duration="${clip.duration}"`,
        `data-track-index="${clip.track}"`,
        `src="${escapeAttr(clip.src)}"`,
        clip.style ? `style="${escapeAttr(clip.style)}"` : "",
      ]
        .filter(Boolean)
        .join("\n        ");
      return `      <img\n        ${attrs}\n      />`;
    }
    case "audio": {
      const attrs = [
        `id="${escapeAttr(clip.id)}"`,
        `data-start="${clip.start}"`,
        clip.duration !== undefined ? `data-duration="${clip.duration}"` : "",
        `data-track-index="${clip.track}"`,
        clip.volume !== undefined ? `data-volume="${clip.volume}"` : "",
        `src="${escapeAttr(clip.src)}"`,
      ]
        .filter(Boolean)
        .join("\n        ");
      return `      <audio\n        ${attrs}\n      ></audio>`;
    }
    case "text": {
      const style =
        clip.style ??
        "top:50%; left:50%; transform:translate(-50%,-50%); color:#fff; font-size:72px; font-weight:bold; text-align:center;";
      return `      <div\n        id="${escapeAttr(clip.id)}"\n        class="clip"\n        data-start="${clip.start}"\n        data-duration="${clip.duration}"\n        data-track-index="${clip.track}"\n        style="position:absolute; ${escapeAttr(
        style,
      )}"\n      >${escapeHtml(clip.content)}</div>`;
    }
  }
}

function buildGsapBlocks(spec: VideoSpec): string {
  const lines: string[] = [];

  for (const clip of spec.clips) {
    if (clip.type !== "text" || !clip.animation) continue;

    const anim = clip.animation;
    const id = clip.id;

    if (anim.entrance) {
      const d = anim.entranceDuration ?? DEFAULT_ENTRANCE_DURATION;
      const pos = clip.start;
      switch (anim.entrance) {
        case "fade-up":
          lines.push(
            `      tl.from("#" + id, { opacity:0, y:40, duration:${d} }, ${pos});`,
          );
          break;
        case "fade-in":
          lines.push(
            `      tl.from("#" + id, { opacity:0, duration:${d} }, ${pos});`,
          );
          break;
        case "slide-left":
          lines.push(
            `      tl.from("#" + id, { opacity:0, x:-80, duration:${d} }, ${pos});`,
          );
          break;
        case "slide-right":
          lines.push(
            `      tl.from("#" + id, { opacity:0, x:80, duration:${d} }, ${pos});`,
          );
          break;
        case "scale-up":
          lines.push(
            `      tl.from("#" + id, { opacity:0, scale:0.8, duration:${d} }, ${pos});`,
          );
          break;
      }
    }

    if (anim.exit) {
      const d = anim.exitDuration ?? DEFAULT_EXIT_DURATION;
      const exitStart = clip.start + clip.duration - d;
      switch (anim.exit) {
        case "fade-out":
          lines.push(
            `      tl.to("#" + id, { opacity:0, duration:${d} }, ${exitStart});`,
          );
          break;
        case "slide-left":
          lines.push(
            `      tl.to("#" + id, { opacity:0, x:-80, duration:${d} }, ${exitStart});`,
          );
          break;
        case "slide-right":
          lines.push(
            `      tl.to("#" + id, { opacity:0, x:80, duration:${d} }, ${exitStart});`,
          );
          break;
        case "fade-down":
          lines.push(
            `      tl.to("#" + id, { opacity:0, y:40, duration:${d} }, ${exitStart});`,
          );
          break;
      }
    }
  }

  return lines.join("\n");
}

/**
 * Run static pre-flight checks against generated composition HTML.
 * Returns an array of error strings. Empty array = valid.
 * These mirror the upstream linter's FATAL checks that would abort a render.
 */
export function validateCompositionHtml(html: string): string[] {
  const errors: string[] = [];

  // Check 1: data-composition-id present on a root element
  if (!html.includes("data-composition-id=")) {
    errors.push("FATAL: No data-composition-id found on root element");
  }

  // Check 2: window.__timelines initialized before assignment
  const initIdx = html.indexOf("window.__timelines = window.__timelines");
  const assignIdx = html.indexOf("window.__timelines[");
  if (assignIdx !== -1 && initIdx === -1) {
    errors.push("FATAL: window.__timelines assigned without initialization");
  }
  if (initIdx !== -1 && assignIdx !== -1 && assignIdx < initIdx) {
    errors.push("FATAL: window.__timelines assigned before initialization");
  }

  // Check 3: no Math.random or Date.now in script blocks
  const scriptBlocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  for (const [, content] of scriptBlocks) {
    if (content.includes("Math.random()")) {
      errors.push("FATAL: Math.random() found in script block (non-deterministic)");
    }
    if (content.includes("Date.now()")) {
      errors.push("FATAL: Date.now() found in script block (non-deterministic)");
    }
  }

  // Check 4: timeline ID matches data-composition-id
  const compIdMatch = html.match(/data-composition-id="([^"]+)"/);
  const timelineMatch = html.match(/window\.__timelines\["([^"]+)"\]/);
  if (compIdMatch && timelineMatch && compIdMatch[1] !== timelineMatch[1]) {
    errors.push(
      `FATAL: timeline_id_mismatch \u2014 data-composition-id="${compIdMatch[1]}" ` +
      `but window.__timelines["${timelineMatch[1]}"]`,
    );
  }

  // Check 5: HyperFrames runtime script must be present
  if (!html.includes("/hyperframes-runtime.js")) {
    errors.push(
      "FATAL: Missing HyperFrames runtime script (/hyperframes-runtime.js)",
    );
  }

  return errors;
}

/**
 * Build a complete HyperFrames index.html string from a VideoSpec.
 * Throws TypeError on any spec validation failure.
 */
export function buildCompositionHtml(spec: VideoSpec): string {
  assertValid(spec);

  const backgroundColor = spec.backgroundColor ?? "#000000";
  const clipsHtml = spec.clips.map(renderClip).join("\n");
  const gsapBlocks = buildGsapBlocks(spec);
  const globalStyles = spec.globalStyles ?? "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: ${backgroundColor}; overflow: hidden; }
    .clip { position: absolute; visibility: hidden; }
    ${globalStyles}
  </style>
  <script src="/hyperframes-runtime.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
</head>
<body>
  <div
    id="stage"
    data-composition-id="${escapeAttr(spec.compositionId)}"
    data-start="0"
    data-width="${spec.width}"
    data-height="${spec.height}"
    style="position:relative; width:${spec.width}px; height:${spec.height}px; overflow:hidden;"
  >
${clipsHtml}
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
${gsapBlocks}
    tl.to({}, { duration: 0.001 }, ${spec.totalDuration});
    window.__timelines["${spec.compositionId}"] = tl;
  </script>
</body>
</html>`;
}
