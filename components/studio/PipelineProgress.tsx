"use client";

import { useEffect, useState } from "react";
import {
  GENERATION_STAGES,
  STAGE_LABELS,
  type GenerationStage,
} from "./studio-reducer";

interface Props {
  stage: GenerationStage;
  startedAt: number;
}

function elapsed(ms: number): string {
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

export default function PipelineProgress({ stage, startedAt }: Props) {
  const [tick, setTick] = useState(0);
  const currentIdx = GENERATION_STAGES.indexOf(stage);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="pipeline">
      <div className="pipeline-header">
        <span className="pipeline-title">Render Pipeline</span>
        <span className="pipeline-elapsed" data-tick={tick}>{elapsed(startedAt)}</span>
      </div>

      <div className="pipeline-stages">
        {GENERATION_STAGES.map((s, i) => {
          const isActive = i === currentIdx;
          const isDone = i < currentIdx;
          return (
            <div
              key={s}
              className={`pipeline-stage${isActive ? " active" : ""}${isDone ? " done" : ""}`}
            >
              <div className="pipeline-dot">
                {isDone ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M3 7.5L6 10.5L11 4"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : isActive ? (
                  <div className="pipeline-spinner" />
                ) : (
                  <div className="pipeline-dot-empty" />
                )}
              </div>
              <span className="pipeline-label">{STAGE_LABELS[s]}</span>
            </div>
          );
        })}
      </div>

      <div className="pipeline-bar">
        <div
          className="pipeline-bar-fill"
          style={{ width: `${((currentIdx + 1) / GENERATION_STAGES.length) * 100}%` }}
        />
      </div>
    </div>
  );
}
