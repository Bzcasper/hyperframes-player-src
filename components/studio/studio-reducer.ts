import type { TextAnimation, VideoSpec } from "@/lib/composition-builder";
import type { JobStatus } from "@/lib/job-store";

/**
 * The six visible pipeline stages, in order. These mirror the real backend
 * lifecycle (validating/building happen client-side + in /api/generate; the
 * sandbox does restoring → preprocessing → capturing → encoding → uploading).
 */
export const GENERATION_STAGES = [
  "validating",
  "building",
  "restoring",
  "rendering",
  "encoding",
  "uploading",
] as const;

export type GenerationStage = (typeof GENERATION_STAGES)[number];

export const STAGE_LABELS: Record<GenerationStage, string> = {
  validating: "Validating spec",
  building: "Building composition",
  restoring: "Restoring sandbox",
  rendering: "Rendering frames",
  encoding: "Encoding MP4",
  uploading: "Uploading to Blob",
};

/** Discriminated union — the single source of truth for the CTA + pipeline. */
export type GenerationState =
  | { status: "idle" }
  | {
      status: "generating";
      stage: GenerationStage;
      jobId: string | null;
      startedAt: number;
    }
  | { status: "success"; url: string; jobId: string | null }
  | { status: "error"; message: string; jobId: string | null };

export type GenerationAction =
  | { type: "START" }
  | { type: "ADVANCE_STAGE"; stage: GenerationStage }
  | { type: "ATTACH_JOB"; jobId: string }
  | { type: "SUCCEED"; url: string }
  | { type: "FAIL"; message: string }
  | { type: "RESET" };

export function generationReducer(
  state: GenerationState,
  action: GenerationAction,
): GenerationState {
  switch (action.type) {
    case "START":
      return {
        status: "generating",
        stage: "validating",
        jobId: null,
        startedAt: Date.now(),
      };

    case "ADVANCE_STAGE": {
      if (state.status !== "generating") return state;
      // Never move backwards — real + simulated progress race, latest-forward wins.
      const current = GENERATION_STAGES.indexOf(state.stage);
      const next = GENERATION_STAGES.indexOf(action.stage);
      if (next <= current) return state;
      return { ...state, stage: action.stage };
    }

    case "ATTACH_JOB": {
      if (state.status !== "generating") return state;
      return { ...state, jobId: action.jobId };
    }

    case "SUCCEED": {
      const jobId = state.status === "generating" ? state.jobId : null;
      return { status: "success", url: action.url, jobId };
    }

    case "FAIL": {
      const jobId =
        state.status === "generating" ? state.jobId : null;
      return { status: "error", message: action.message, jobId };
    }

    case "RESET":
      return { status: "idle" };

    default:
      return state;
  }
}

/** Maps a real backend job status onto a visible pipeline stage. */
export function jobStatusToStage(status: JobStatus): GenerationStage | null {
  switch (status) {
    case "queued":
      return "building";
    case "restoring":
      return "restoring";
    case "preprocessing":
      return "rendering";
    case "rendering":
      return "rendering";
    case "encoding":
      return "encoding";
    case "assembling":
      return "encoding";
    case "uploading":
      return "uploading";
    default:
      return null;
  }
}

/* ----------------------------- Form model ------------------------------ */

export type AspectFormat = "16:9" | "9:16" | "1:1";
export type StylePreset = "cinematic" | "minimal" | "vibrant" | "corporate";
export type AnimationIntensity = "subtle" | "balanced" | "dynamic";

export interface StudioForm {
  prompt: string;
  style: StylePreset;
  duration: number;
  format: AspectFormat;
  intensity: AnimationIntensity;
  subtitles: boolean;
}

export const DEFAULT_FORM: StudioForm = {
  prompt: "",
  style: "cinematic",
  duration: 8,
  format: "16:9",
  intensity: "balanced",
  subtitles: true,
};

const FORMAT_DIMENSIONS: Record<AspectFormat, { width: number; height: number }> =
  {
    "16:9": { width: 1920, height: 1080 },
    "9:16": { width: 1080, height: 1920 },
    "1:1": { width: 1080, height: 1080 },
  };

const STYLE_BACKGROUNDS: Record<StylePreset, string> = {
  cinematic: "#0a0a0f",
  minimal: "#12121a",
  vibrant: "#161029",
  corporate: "#0d1117",
};

const STYLE_HEADLINE_COLOR: Record<StylePreset, string> = {
  cinematic: "#f0f0ff",
  minimal: "#f0f0ff",
  vibrant: "#a89bff",
  corporate: "#e6edf3",
};

const INTENSITY_ANIMATION: Record<
  AnimationIntensity,
  Required<Pick<TextAnimation, "entrance" | "exit">>
> = {
  subtle: { entrance: "fade-in", exit: "fade-out" },
  balanced: { entrance: "fade-up", exit: "fade-out" },
  dynamic: { entrance: "scale-up", exit: "fade-down" },
};

/** Slugify the prompt into a valid compositionId (/^[a-z0-9-]+$/). */
export function toCompositionId(prompt: string): string {
  const base = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const stamp = Date.now().toString(36);
  return base ? `${base}-${stamp}` : `composition-${stamp}`;
}

/**
 * Translate the friendly studio form into a backend-valid VideoSpec.
 * Headline lives on track 1, optional subtitle on track 0 — never overlapping.
 */
export function buildSpecFromForm(form: StudioForm): VideoSpec {
  const { width, height } = FORMAT_DIMENSIONS[form.format];
  const duration = Math.max(3, Math.min(60, Math.round(form.duration)));
  const anim = INTENSITY_ANIMATION[form.intensity];
  const headlineColor = STYLE_HEADLINE_COLOR[form.style];
  const headlineSize = form.format === "9:16" ? 84 : 104;

  const clips: VideoSpec["clips"] = [
    {
      type: "text",
      id: "headline",
      content: form.prompt.trim() || "Untitled composition",
      start: 0.4,
      duration: Math.max(1, duration - 0.8),
      track: 1,
      style: `top:46%; left:50%; transform:translate(-50%,-50%); width:80%; text-align:center; color:${headlineColor}; font-size:${headlineSize}px; font-weight:800; line-height:1.1; letter-spacing:-0.02em;`,
      animation: {
        entrance: anim.entrance,
        exit: anim.exit,
        entranceDuration: 0.5,
        exitDuration: 0.4,
      },
    },
  ];

  if (form.subtitles) {
    clips.push({
      type: "text",
      id: "subtitle",
      content: `${form.style.toUpperCase()} · ${form.format}`,
      start: 1,
      duration: Math.max(1, duration - 2),
      track: 0,
      style:
        "top:64%; left:50%; transform:translate(-50%,-50%); text-align:center; color:#8888aa; font-size:34px; font-weight:500; letter-spacing:0.18em; text-transform:uppercase;",
      animation: {
        entrance: "fade-in",
        exit: "fade-out",
        entranceDuration: 0.6,
        exitDuration: 0.4,
      },
    });
  }

  return {
    compositionId: toCompositionId(form.prompt),
    width,
    height,
    totalDuration: duration,
    backgroundColor: STYLE_BACKGROUNDS[form.style],
    clips,
  };
}
