"use client";

import { useEffect, useReducer, useState, useRef, useCallback } from "react";
import styles from "./page.module.css";
import StudioForm from "@/components/studio/StudioForm";
import PipelineProgress from "@/components/studio/PipelineProgress";
import JobHistory from "@/components/studio/JobHistory";
import {
  generationReducer,
  DEFAULT_FORM,
  buildSpecFromForm,
  jobStatusToStage,
  type StudioForm as StudioFormType,
  type GenerationStage,
} from "@/components/studio/studio-reducer";

const COMPOSITION_WIDTH = 1920;
const COMPOSITION_HEIGHT = 1080;

type HyperframesPlayerElement = HTMLElement & {
  pause?: () => void;
  currentTime?: number;
  src?: string;
};

export default function Home() {
  const [gen, dispatch] = useReducer(generationReducer, { status: "idle" });
  const [form, setForm] = useState<StudioFormType>(DEFAULT_FORM);
  const [playerLoaded, setPlayerLoaded] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("/api/preview");
  const [jobRefreshKey, setJobRefreshKey] = useState(0);
  const playerRef = useRef<HyperframesPlayerElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSpecRef = useRef<string | null>(null);

  // Load the player
  useEffect(() => {
    let cancelled = false;
    import("@hyperframes/player").then(() => {
      if (!cancelled) setPlayerLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Reset player on idle / form changes
  useEffect(() => {
    if (gen.status === "idle") {
      setPreviewUrl("/api/preview");
    }
  }, [gen.status]);

  // Poll job status while generating
  const gen_jobId = gen.status === "generating" ? gen.jobId : null;
  const genIsGenerating = gen.status === "generating";
  useEffect(() => {
    if (!gen_jobId || !genIsGenerating) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${gen_jobId}`);
        if (!res.ok) return;
        const job = (await res.json()) as {
          status: string;
          url?: string;
          error?: string;
        };

        const stage = jobStatusToStage(job.status as Parameters<typeof jobStatusToStage>[0]);
        if (stage) dispatch({ type: "ADVANCE_STAGE", stage });

        if (job.status === "done" && job.url) {
          dispatch({ type: "SUCCEED", url: job.url });
          if (pollRef.current) clearInterval(pollRef.current);
          setJobRefreshKey((k) => k + 1);
        } else if (job.status === "failed") {
          dispatch({ type: "FAIL", message: job.error ?? "Render failed" });
          if (pollRef.current) clearInterval(pollRef.current);
          setJobRefreshKey((k) => k + 1);
        }
      } catch {
        // keep polling
      }
    }, 1500);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [gen_jobId, genIsGenerating]);

  const handleGenerate = useCallback(async () => {
    dispatch({ type: "START" });

    try {
      const spec = buildSpecFromForm(form);
      lastSpecRef.current = spec.compositionId;

      // Advance to building stage
      dispatch({ type: "ADVANCE_STAGE", stage: "building" as GenerationStage });

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Generate failed (${res.status})`);
      }

      const data = (await res.json()) as { jobId: string };
      dispatch({ type: "ATTACH_JOB", jobId: data.jobId });
    } catch (err) {
      dispatch({
        type: "FAIL",
        message: err instanceof Error ? err.message : "Generation failed",
      });
    }
  }, [form]);

  const handleReset = useCallback(() => {
    dispatch({ type: "RESET" });
    setPreviewUrl("/api/preview");
  }, []);

  const handleFormChange = useCallback((patch: Partial<StudioFormType>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>HyperFrames Studio</h1>
        <p>
          Describe your video, pick a style, and render it server-side on Vercel.
        </p>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <StudioForm
            form={form}
            onChange={handleFormChange}
            onGenerate={handleGenerate}
            disabled={gen.status === "generating"}
          />

          {gen.status === "generating" && (
            <PipelineProgress stage={gen.stage} startedAt={gen.startedAt} />
          )}

          {gen.status === "success" && (
            <div className={styles.successBanner}>
              <span className={styles.successIcon}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <circle cx="9" cy="9" r="9" fill="var(--success-soft)" />
                  <path
                    d="M5 9.5L7.5 12L13 6.5"
                    stroke="var(--success)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div>
                <strong>Render complete</strong>
                <br />
                <a
                  href={gen.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.downloadLink}
                >
                  Open MP4 &rarr;
                </a>
              </div>
              <button className={styles.resetBtn} onClick={handleReset}>
                New
              </button>
            </div>
          )}

          {gen.status === "error" && (
            <div className={styles.errorBanner}>
              <strong>Error</strong>
              <p>{gen.message}</p>
              <button className={styles.resetBtn} onClick={handleReset}>
                Try again
              </button>
            </div>
          )}

          <JobHistory refreshKey={jobRefreshKey} />
        </aside>

        <section className={styles.playerWrap}>
          {playerLoaded ? (
            /* @ts-expect-error — custom element */
            <hyperframes-player
              ref={playerRef}
              src={gen.status === "success" ? gen.url : previewUrl}
              width={COMPOSITION_WIDTH}
              height={COMPOSITION_HEIGHT}
              controls
              key={gen.status === "success" ? gen.url : "preview"}
            />
          ) : (
            <div className={styles.playerLoading}>
              <div className={styles.spinner} />
              <p>Loading player…</p>
            </div>
          )}
        </section>
      </div>

      <footer className={styles.footer}>
        <a
          href="https://github.com/heygen-com/hyperframes"
          target="_blank"
          rel="noopener noreferrer"
        >
          HyperFrames on GitHub
        </a>
        <span className={styles.dot}>&middot;</span>
        <a
          href="https://hyperframes.heygen.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Docs
        </a>
        <span className={styles.dot}>&middot;</span>
        <a href="/api/status" target="_blank" rel="noopener noreferrer">
          API Status
        </a>
      </footer>
    </main>
  );
}
