"use client";

import { useEffect, useReducer, useState, useRef, useCallback } from "react";
import type { RenderJob } from "@/lib/job-store";

/* ───────── hyperframes-player web component declaration ───────── */
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "hyperframes-player": React.HTMLAttributes<HTMLElement>;
    }
  }
}

/* ───────── types ───────── */
type TemplateName =
  | "jewelry-reveal"
  | "youtube-intro"
  | "price-drop"
  | "custom";

type SpendInfo = {
  rendersToday: number;
  dailyLimit: number;
  resetAt: string;
};

type RenderState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "polling"; jobId: string; job: RenderJob }
  | { status: "done"; job: RenderJob }
  | { status: "error"; message: string; jobId?: string };

type RenderAction =
  | { type: "SUBMIT" }
  | { type: "JOB_CREATED"; jobId: string; job: RenderJob }
  | { type: "POLL_UPDATE"; job: RenderJob }
  | { type: "DONE"; job: RenderJob }
  | { type: "ERROR"; message: string; jobId?: string }
  | { type: "RESET" };

/* ───────── reducer ───────── */
function renderReducer(state: RenderState, action: RenderAction): RenderState {
  switch (action.type) {
    case "SUBMIT":
      return { status: "submitting" };
    case "JOB_CREATED":
      return { status: "polling", jobId: action.jobId, job: action.job };
    case "POLL_UPDATE":
      if (state.status !== "polling") return state;
      return { ...state, job: action.job };
    case "DONE":
      return { status: "done", job: action.job };
    case "ERROR":
      return { status: "error", message: action.message, jobId: action.jobId };
    case "RESET":
      return { status: "idle" };
    default:
      return state;
  }
}

/* ───────── helpers ───────── */
const STAGE_MAP: Record<
  string,
  { label: string; width: number }
> = {
  queued: { label: "In queue\u2026", width: 5 },
  restoring: { label: "Restoring sandbox\u2026", width: 15 },
  preprocessing: { label: "Preprocessing\u2026", width: 30 },
  capturing: { label: "Capturing frames\u2026", width: 65 },
  encoding: { label: "Encoding MP4\u2026", width: 85 },
  uploading: { label: "Uploading to Blob\u2026", width: 95 },
  done: { label: "Done", width: 100 },
  failed: { label: "Failed", width: 100 },
};

function getStageForStatus(status: string): { label: string; width: number } {
  return STAGE_MAP[status] ?? { label: status, width: 50 };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

function durationStr(ms: number | null): string {
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  return `Rendered in ${s}s`;
}

/* ───────── Header ───────── */
function Header({
  spend,
  renderStatus,
}: {
  spend: SpendInfo | null;
  renderStatus: RenderState["status"];
}): React.ReactElement {
  const statusColor =
    renderStatus === "idle" || renderStatus === "done"
      ? "var(--success)"
      : renderStatus === "error"
        ? "var(--error)"
        : "#f59e0b";

  return (
    <header className="fixed top-0 left-0 right-0 h-[52px] flex items-center px-5 border-b z-30"
            style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
      <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        ⬡ HyperFrames Studio
      </div>

      <div className="flex-1 flex justify-center">
        {spend && (
          <SpendBadge spend={spend} />
        )}
      </div>

      <div className="flex items-center gap-2">
        <div
          className="w-[10px] h-[10px] rounded-full animate-hf-dot-pulse"
          style={{ background: statusColor, boxShadow: `0 0 8px ${statusColor}` }}
        />
        <span className="text-[10px] uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}>
          {renderStatus === "polling" || renderStatus === "submitting" ? "Rendering" : "Ready"}
        </span>
      </div>
    </header>
  );
}

function SpendBadge({ spend }: { spend: SpendInfo }): React.ReactElement {
  const ratio = spend.rendersToday / spend.dailyLimit;
  let prefix = "";
  let color = "var(--text-muted)";
  if (ratio >= 1) {
    prefix = "\u{1F6D1} ";
    color = "var(--error)";
  } else if (ratio >= 0.8) {
    prefix = "\u26A0 ";
    color = "#f59e0b";
  }

  return (
    <span className="text-xs font-mono" style={{ color }}>
      {prefix}{spend.rendersToday} / {spend.dailyLimit} renders today
    </span>
  );
}

/* ───────── CompositionBrowser ───────── */
function CompositionBrowser({
  compositions,
  activeComposition,
  onSelect,
  open,
  onToggle,
}: {
  compositions: string[];
  activeComposition: string | null;
  onSelect: (name: string) => void;
  open: boolean;
  onToggle: () => void;
}): React.ReactElement {
  if (!open) {
    return (
      <aside className="flex-shrink-0 border-r flex flex-col items-center pt-4 cursor-pointer"
             style={{ width: 48, borderColor: "var(--border)", background: "var(--bg-surface)" }}
             onClick={onToggle}>
        <span style={{ color: "var(--text-muted)", fontSize: 18 }}>{">"}</span>
      </aside>
    );
  }

  return (
    <aside className="flex-shrink-0 border-r flex flex-col overflow-hidden"
           style={{ width: 260, borderColor: "var(--border)", background: "var(--bg-surface)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b"
           style={{ borderColor: "var(--border)" }}>
        <span className="text-[10px] font-bold uppercase tracking-[0.08em]"
              style={{ color: "var(--text-muted)" }}>
          Compositions
          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px]"
                style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
            {compositions.length}
          </span>
        </span>
        <button onClick={onToggle} className="text-sm" style={{ color: "var(--text-muted)" }}>
          {"<"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {compositions.length === 0 ? (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg animate-hf-shimmer"
                   style={{ height: 100 }} />
            ))}
          </>
        ) : (
          compositions.map((name) => (
            <button
              key={name}
              onClick={() => onSelect(name)}
              className="w-full rounded-lg overflow-hidden text-left transition-colors"
              style={{
                border: "1px solid var(--border)",
                borderLeft: name === activeComposition ? "3px solid var(--accent)" : "1px solid var(--border)",
                background: name === activeComposition ? "var(--bg-elevated)" : "transparent",
              }}>
              <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
                <img
                  src={`/compositions/${name}/thumbnail.png`}
                  alt={name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                    const parent = (e.currentTarget as HTMLImageElement).parentElement;
                    if (parent) {
                      parent.innerHTML = `<span style="color:var(--text-muted);font-size:11px;font-family:var(--font-mono)">${name}</span>`;
                    }
                  }}
                />
              </div>
              <div className="px-2.5 py-2">
                <span className="text-xs font-mono" style={{ color: "var(--text-primary)" }}>
                  {name}
                </span>
              </div>
            </button>
          ))
        )}
      </div>

      {compositions.length === 0 && (
        <div className="flex flex-col items-center justify-center flex-1 p-4 text-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No compositions
          </p>
          <a
            href="https://hyperframes.heygen.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs mt-1 underline"
            style={{ color: "var(--accent)" }}>
            Browse registry
          </a>
        </div>
      )}
    </aside>
  );
}

/* ───────── PlayerPane ───────── */
function PlayerPane({
  activeComposition,
  renderState,
}: {
  activeComposition: string | null;
  renderState: RenderState;
}): React.ReactElement {
  const playerRef = useRef<HTMLElement | null>(null);

  const isSquare =
    activeComposition?.endsWith("-square") ??
    false;

  const aspectRatio = isSquare ? "1 / 1" : "16 / 9";

  const playerSrc = (() => {
    if (renderState.status === "done" && renderState.job.url) {
      return renderState.job.url;
    }
    if (activeComposition) {
      return `/compositions/${activeComposition}/`;
    }
    return "";
  })();

  useEffect(() => {
    const el = document.querySelector("hyperframes-player");
    if (el && playerSrc) {
      el.setAttribute("src", playerSrc);
    }
  }, [playerSrc]);

  return (
    <div className="flex-1 flex flex-col min-w-0 p-4">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs font-mono truncate" style={{ color: "var(--text-muted)" }}>
          {activeComposition ?? "\u2014"}
        </span>
        <span className="text-[10px] uppercase tracking-widest font-semibold"
              style={{ color: "var(--accent)" }}>
          Preview
        </span>
      </div>

      <div
        className="flex-1 rounded-xl border flex items-center justify-center overflow-hidden"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-surface)",
          aspectRatio,
          maxHeight: "calc(100vh - 52px - 280px)",
        }}>
        {activeComposition || renderState.status === "done" ? (
          /* @ts-expect-error - custom web component */
          <hyperframes-player
            ref={playerRef}
            src={playerSrc}
            className="w-full h-full"
          />
        ) : (
          <div className="text-center">
            <p className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>
              Select a composition \u2191
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────── RenderControls ───────── */
function RenderControls({
  activeTemplate,
  onTemplateChange,
  templateParams,
  onParamChange,
  disabled,
}: {
  activeTemplate: TemplateName;
  onTemplateChange: (t: TemplateName) => void;
  templateParams: Record<string, string>;
  onParamChange: (key: string, value: string) => void;
  disabled: boolean;
}): React.ReactElement {
  const templates: { key: TemplateName; label: string }[] = [
    { key: "jewelry-reveal", label: "Jewelry Reveal" },
    { key: "youtube-intro", label: "YouTube Intro" },
    { key: "price-drop", label: "Price Drop" },
    { key: "custom", label: "Custom" },
  ];

  const fields = (() => {
    if (activeTemplate === "jewelry-reveal") {
      return [
        { key: "title", label: "Title", placeholder: "Tennis Bracelet" },
        { key: "price", label: "Price", placeholder: "$349" },
        {
          key: "subtitle",
          label: "Subtitle (optional)",
          placeholder: "Estate Collection",
        },
      ];
    }
    if (activeTemplate === "youtube-intro") {
      return [
        { key: "episodeTitle", label: "Episode Title", placeholder: "DIY Jewelry Cleaner" },
        { key: "channelName", label: "Channel Name", placeholder: "@CreationcompanionDIY" },
      ];
    }
    if (activeTemplate === "price-drop") {
      return [
        { key: "productName", label: "Product Name", placeholder: "Tennis Bracelet" },
        { key: "originalPrice", label: "Original Price", placeholder: "$120" },
        { key: "salePrice", label: "Sale Price", placeholder: "$79" },
        { key: "badgeText", label: "Badge Text", placeholder: "34% OFF" },
      ];
    }
    return [];
  })();

  return (
    <div className="px-4 pb-4">
      {/* Template pills */}
      <div className="flex gap-1.5 mb-3">
        {templates.map((t) => (
          <button
            key={t.key}
            disabled={disabled}
            onClick={() => onTemplateChange(t.key)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
            style={{
              background:
                activeTemplate === t.key ? "var(--accent)" : "transparent",
              color:
                activeTemplate === t.key ? "#fff" : "var(--text-muted)",
              border:
                activeTemplate === t.key
                  ? "1px solid var(--accent)"
                  : "1px solid var(--border)",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Param fields */}
      {activeTemplate === "custom" ? (
        <textarea
          disabled={disabled}
          value={templateParams.rawSpec ?? ""}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            onParamChange("rawSpec", e.currentTarget.value)
          }
          placeholder='{ "compositionId": "my-video", "clips": [...] }'
          className="w-full rounded-md px-3 py-2 text-xs font-mono resize-none"
          style={{
            height: 100,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {fields.map((f) => (
            <div key={f.key} className={fields.length === 1 ? "col-span-2" : ""}>
              <label className="block text-[10px] uppercase tracking-widest mb-1"
                     style={{ color: "var(--text-muted)" }}>
                {f.label}
              </label>
              <input
                disabled={disabled}
                value={templateParams[f.key] ?? ""}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onParamChange(f.key, e.currentTarget.value)
                }
                placeholder={f.placeholder}
                className="w-full rounded-md px-3 py-2 text-sm font-mono placeholder-transparent"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                }}
                onFocus={(e) => {
                  (e.currentTarget as HTMLInputElement).style.borderColor =
                    "var(--accent)";
                  (e.currentTarget as HTMLInputElement).style.outline = "none";
                }}
                onBlur={(e) => {
                  (e.currentTarget as HTMLInputElement).style.borderColor =
                    "var(--border)";
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────── RenderButton ───────── */
function RenderButton({
  renderState,
  activeTemplate,
  templateParams,
  onRender,
  onReset,
}: {
  renderState: RenderState;
  activeTemplate: TemplateName;
  templateParams: Record<string, string>;
  onRender: () => void;
  onReset: () => void;
}): React.ReactElement {
  if (renderState.status === "submitting") {
    return (
      <div className="flex flex-col items-center mt-6">
        <div className="flex items-center justify-center gap-3 rounded-full"
             style={{
               minWidth: 280,
               height: 56,
               background: "var(--bg-elevated)",
               border: "1px solid var(--accent)",
               color: "var(--text-primary)",
             }}>
          <div className="w-4 h-4 rounded-full border-2 animate-hf-spin"
               style={{
                 borderColor: "var(--accent-soft)",
                 borderTopColor: "var(--accent)",
               }} />
          <span className="font-semibold text-sm">Submitting job\u2026</span>
        </div>
      </div>
    );
  }

  if (renderState.status === "polling") {
    const stage = getStageForStatus(renderState.job.status);
    return (
      <div className="flex flex-col items-center mt-6">
        <div className="relative flex items-center justify-center gap-3 rounded-full overflow-hidden"
             style={{
               minWidth: 280,
               height: 56,
               background: "var(--bg-elevated)",
               border: "1px solid var(--accent)",
               color: "var(--text-primary)",
             }}>
          <div className="absolute left-0 inset-y-0 rounded-full transition-all"
               style={{
                 width: `${stage.width}%`,
                 background: "var(--accent)",
                 opacity: 0.2,
                 transition: "width 1.5s ease",
               }} />
          <div className="relative flex items-center gap-2">
            <div className="w-3 h-3 rounded-full border-2 animate-hf-spin"
                 style={{
                   borderColor: "var(--accent-soft)",
                   borderTopColor: "var(--accent)",
                 }} />
            <span className="font-semibold text-sm">{stage.label}</span>
          </div>
        </div>
        <span className="mt-1.5 text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
          JOB #{renderState.jobId.slice(0, 8)}
        </span>
      </div>
    );
  }

  if (renderState.status === "done") {
    return (
      <div className="flex flex-col items-center mt-6">
        <button
          onClick={() => {
            if (renderState.job.url) window.open(renderState.job.url, "_blank");
          }}
          className="flex items-center justify-center gap-2 rounded-full font-semibold text-white text-base transition-opacity hover:opacity-90"
          style={{
            minWidth: 280,
            height: 56,
            background: "linear-gradient(135deg, #22d3a0, #0ea5e9)",
          }}>
          {"\u2713"}  Download MP4
        </button>
        <button
          onClick={onReset}
          className="mt-2 px-6 py-2 rounded-full text-sm transition-colors"
          style={{
            border: "1px solid var(--accent)",
            color: "var(--accent)",
            background: "transparent",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "var(--accent)";
            (e.currentTarget as HTMLButtonElement).style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--accent)";
          }}>
          Render Again
        </button>
        <span className="mt-1 text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
          {durationStr(renderState.job.durationMs)}
        </span>
      </div>
    );
  }

  if (renderState.status === "error") {
    return (
      <div className="flex flex-col items-center mt-6">
        <button
          onClick={onReset}
          className="flex items-center justify-center gap-2 rounded-full font-semibold text-white text-base transition-opacity hover:opacity-90"
          style={{
            minWidth: 280,
            height: 56,
            background: "linear-gradient(135deg, #ff4f6d, #f97316)",
          }}>
          {"\u2717"}  Render Failed
        </button>
        <p className="mt-1.5 text-xs font-mono text-center max-w-xs"
           style={{ color: "var(--error)" }}>
          {renderState.message}
        </p>
      </div>
    );
  }

  /* idle state */
  return (
    <div className="flex flex-col items-center mt-6">
      <button
        onClick={onRender}
        className="flex items-center justify-center gap-2 rounded-full font-semibold text-white text-base animate-hf-glow-pulse transition-opacity hover:opacity-90"
        style={{
          minWidth: 280,
          height: 56,
          background: "linear-gradient(135deg, #6c63ff, #a855f7)",
          boxShadow: "var(--accent-glow)",
        }}>
        {"\u25B6"}  Render Video
      </button>
      <span className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
        Press <kbd className="px-1 py-0.5 rounded text-[9px] font-mono"
                   style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          R
        </kbd> to render
      </span>
    </div>
  );
}

/* ───────── JobMonitor ───────── */
function JobMonitor({
  jobs,
  activeJobId,
  open,
  onToggle,
}: {
  jobs: RenderJob[];
  activeJobId: string | null;
  open: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (!open) {
    return (
      <aside className="flex-shrink-0 border-l flex flex-col items-center pt-4 cursor-pointer"
             style={{ width: 48, borderColor: "var(--border)", background: "var(--bg-surface)" }}
             onClick={onToggle}>
        <span style={{ color: "var(--text-muted)", fontSize: 18 }}>{"<"}</span>
      </aside>
    );
  }

  const sorted = [...jobs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <aside className="flex-shrink-0 border-l flex flex-col overflow-hidden"
           style={{ width: 280, borderColor: "var(--border)", background: "var(--bg-surface)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b"
           style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.08em]"
                style={{ color: "var(--text-muted)" }}>
            Job Monitor
          </span>
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
            {jobs.length}
          </span>
          <div className="w-[6px] h-[6px] rounded-full animate-hf-dot-pulse"
               style={{ background: "var(--success)" }} />
          <span className="text-[9px] font-bold uppercase tracking-wider"
                style={{ color: "var(--success)" }}>
            LIVE
          </span>
        </div>
        <button onClick={onToggle} className="text-sm" style={{ color: "var(--text-muted)" }}>
          {"\u2039"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Waiting for jobs\u2026
            </p>
          </div>
        ) : (
          sorted.map((job) => {
            const isActive = job.id === activeJobId;
            return (
              <div
                key={job.id}
                className="relative rounded-lg p-3 border transition-colors animate-hf-fade-in"
                style={{
                  background: "var(--bg-elevated)",
                  borderColor: isActive ? "var(--accent)" : "var(--border)",
                  borderLeft: isActive ? "2px solid var(--accent)" : "1px solid var(--border)",
                }}
                onMouseEnter={() => setHoveredId(job.id)}
                onMouseLeave={() => setHoveredId(null)}>
                {/* Row 1: ID + status + agent */}
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="font-mono text-[11px] truncate"
                        style={{ color: "var(--text-primary)" }}>
                    {job.id.slice(0, 8)}
                  </span>
                  <StatusBadge status={job.status} />
                  {job.agentId && (
                    <span className="text-[10px] px-1 rounded"
                          style={{
                            color: "var(--accent)",
                            background: "var(--accent-soft)",
                          }}>
                      {job.agentId}
                    </span>
                  )}
                </div>

                {/* Row 2: composition + endpoint */}
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-mono truncate"
                        style={{ color: "var(--text-muted)" }}>
                    {job.composition}
                  </span>
                  <span className="text-[9px] px-1 rounded uppercase"
                        style={{
                          color: "var(--text-muted)",
                          background: "var(--bg-surface)",
                        }}>
                    {job.endpoint}
                  </span>
                </div>

                {/* Row 3: timestamps */}
                <div className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                  {job.completedAt
                    ? `done in ${durationStr(job.durationMs)}`
                    : job.startedAt
                      ? `started ${timeAgo(job.startedAt)}`
                      : timeAgo(job.createdAt)}
                </div>

                {/* Row 4: done — MP4 link */}
                {job.status === "done" && job.url && (
                  <div className="mt-1">
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-mono"
                      style={{ color: "var(--accent)" }}>
                      {"\u2B07"} MP4
                    </a>
                  </div>
                )}

                {/* Row 5: failed — error message */}
                {job.status === "failed" && job.error && (
                  <p className="mt-1 text-[10px] font-mono line-clamp-2"
                     style={{ color: "var(--error)" }}>
                    {job.error}
                  </p>
                )}

                {/* Hover video preview for done jobs */}
                {job.status === "done" && job.url && hoveredId === job.id && (
                  <div className="absolute right-full mr-3 top-0 z-50 rounded-md border overflow-hidden"
                       style={{
                         width: 200,
                         borderColor: "var(--border)",
                         pointerEvents: "none",
                       }}>
                    <video
                      src={job.url}
                      muted
                      autoPlay
                      loop
                      playsInline
                      className="w-full block"
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const isDone = status === "done";
  const isFailed = status === "failed";
  let bg: string;
  let color: string;
  if (isDone) {
    bg = "rgba(34,211,160,0.2)";
    color = "var(--success)";
  } else if (isFailed) {
    bg = "rgba(255,79,109,0.2)";
    color = "var(--error)";
  } else {
    bg = "rgba(245,158,11,0.2)";
    color = "#f59e0b";
  }

  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider"
      style={{ background: bg, color }}>
      {status}
    </span>
  );
}

/* ───────── Mobile Bottom Sheet ───────── */
function MobileSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}): React.ReactElement | null {
  if (!open) return null;

  return (
    <>
      <div className="hf-backdrop" onClick={onClose} />
      <div className="hf-sheet">
        <div className="hf-sheet-header">
          <span>{title}</span>
          <button className="hf-sheet-close" onClick={onClose}>
            {"\u2715"}
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

/* ───────── Root: StudioPage ───────── */
export default function StudioPage(): React.ReactElement {
  const [compositions, setCompositions] = useState<string[]>([]);
  const [activeComposition, setActiveComposition] = useState<string | null>(null);
  const [renderState, dispatch] = useReducer(renderReducer, { status: "idle" });
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [spend, setSpend] = useState<SpendInfo | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [activeTemplate, setActiveTemplate] = useState<TemplateName>("jewelry-reveal");
  const [templateParams, setTemplateParams] = useState<Record<string, string>>({});
  const [mobileSheet, setMobileSheet] = useState<"compositions" | "jobs" | null>(null);

  /* ── mount: fetch all ── */
  useEffect(() => {
    async function init(): Promise<void> {
      const [compRes, jobsRes, statusRes] = await Promise.allSettled([
        fetch("/api/compositions"),
        fetch("/api/jobs"),
        fetch("/api/status"),
      ]);

      if (compRes.status === "fulfilled" && compRes.value.ok) {
        const data = (await compRes.value.json()) as { compositions: string[] };
        setCompositions(data.compositions);
        if (data.compositions.length > 0) {
          setActiveComposition(data.compositions[0]);
        }
      }

      if (jobsRes.status === "fulfilled" && jobsRes.value.ok) {
        const data = (await jobsRes.value.json()) as { jobs: RenderJob[] };
        setJobs(data.jobs);
      }

      if (statusRes.status === "fulfilled" && statusRes.value.ok) {
        const data = (await statusRes.value.json()) as { spend: SpendInfo };
        setSpend(data.spend);
      }
    }
    init();
  }, []);

  /* ── poll jobs every 8s ── */
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/jobs");
        if (res.ok) {
          const data = (await res.json()) as { jobs: RenderJob[] };
          setJobs(data.jobs);
        }
      } catch {
        /* keep polling */
      }
    }, 8000);
    return () => clearInterval(id);
  }, []);

  /* ── poll status every 30s ── */
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/status");
        if (res.ok) {
          const data = (await res.json()) as { spend: SpendInfo };
          setSpend(data.spend);
        }
      } catch {
        /* keep polling */
      }
    }, 30000);
    return () => clearInterval(id);
  }, []);

  /* ── poll job detail when rendering ── */
  const pollJobId = renderState.status === "polling" ? renderState.jobId : null;
  useEffect(() => {
    if (!pollJobId) return;

    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${pollJobId}`);
        if (!res.ok) return;
        const job = (await res.json()) as RenderJob;

        if (job.status === "done") {
          dispatch({ type: "DONE", job });
          clearInterval(id);
          /* refresh job list */
          const jr = await fetch("/api/jobs");
          if (jr.ok) {
            const jd = (await jr.json()) as { jobs: RenderJob[] };
            setJobs(jd.jobs);
          }
        } else if (job.status === "failed") {
          dispatch({ type: "ERROR", message: job.error ?? "Render failed", jobId: job.id });
          clearInterval(id);
          const jr = await fetch("/api/jobs");
          if (jr.ok) {
            const jd = (await jr.json()) as { jobs: RenderJob[] };
            setJobs(jd.jobs);
          }
        } else {
          dispatch({ type: "POLL_UPDATE", job });
        }
      } catch {
        /* keep polling */
      }
    }, 5000);

    return () => clearInterval(id);
  }, [pollJobId]);

  /* ── handle render ── */
  const handleRender = useCallback(async () => {
    dispatch({ type: "SUBMIT" });

    try {
      let res: Response;

      if (activeTemplate === "custom") {
        let spec: unknown;
        try {
          spec = JSON.parse(templateParams.rawSpec ?? "{}");
        } catch {
          dispatch({ type: "ERROR", message: "Invalid JSON in spec" });
          return;
        }
        res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spec }),
        });
      } else {
        const compositionId = `${activeTemplate}-${Date.now()}`;
        const params: Record<string, string> = {
          compositionId,
          ...templateParams,
        };
        res = await fetch("/api/render-template", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template: activeTemplate, params }),
        });
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Request failed (${res.status})`);
      }

      const data = (await res.json()) as {
        jobId: string;
        composition: string;
        createdAt: string;
      };

      const placeholder: RenderJob = {
        id: data.jobId,
        composition: data.composition,
        endpoint: activeTemplate === "custom" ? ("generate" as const) : ("jobs" as const),
        status: "queued",
        createdAt: data.createdAt,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        url: null,
        error: null,
        callbackUrl: null,
        agentId: null,
        meta: {},
      };

      dispatch({ type: "JOB_CREATED", jobId: data.jobId, job: placeholder });

      /* optimistically prepend to job list */
      setJobs((prev) => [placeholder, ...prev]);
    } catch (err) {
      dispatch({
        type: "ERROR",
        message: err instanceof Error ? err.message : "Render failed",
      });
    }
  }, [activeTemplate, templateParams]);

  /* ── keyboard shortcut (refs to avoid re-registration) ── */
  const handleRenderRef = useRef(handleRender);
  handleRenderRef.current = handleRender;
  const renderStateRef = useRef(renderState);
  renderStateRef.current = renderState;

  useEffect(() => {
    function handler(e: KeyboardEvent): void {
      if (e.key === "r" || e.key === "R") {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (renderStateRef.current.status === "idle") {
          e.preventDefault();
          handleRenderRef.current();
        }
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleReset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  const handleCompositionSelect = useCallback((name: string) => {
    setActiveComposition(name);
  }, []);

  const handleTemplateChange = useCallback((t: TemplateName) => {
    setActiveTemplate(t);
    setTemplateParams({});
  }, []);

  const handleParamChange = useCallback((key: string, value: string) => {
    setTemplateParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const activeJobId =
    renderState.status === "polling" ? renderState.jobId
    : renderState.status === "done" ? renderState.job.id
    : null;

  return (
    <div className="h-screen flex flex-col overflow-hidden"
         style={{ background: "var(--bg-base)" }}>
      {/* ── header ── */}
      <Header spend={spend} renderStatus={renderState.status} />

      {/* ── body: desktop ── */}
      <div className="flex-1 flex pt-[52px] max-md:hidden">
        <CompositionBrowser
          compositions={compositions}
          activeComposition={activeComposition}
          onSelect={handleCompositionSelect}
          open={leftOpen}
          onToggle={() => setLeftOpen((v) => !v)}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <PlayerPane
            activeComposition={activeComposition}
            renderState={renderState}
          />
          <div className="border-t" style={{ borderColor: "var(--border)" }}>
            <RenderControls
              activeTemplate={activeTemplate}
              onTemplateChange={handleTemplateChange}
              templateParams={templateParams}
              onParamChange={handleParamChange}
              disabled={renderState.status !== "idle"}
            />
            <RenderButton
              renderState={renderState}
              activeTemplate={activeTemplate}
              templateParams={templateParams}
              onRender={handleRender}
              onReset={handleReset}
            />
          </div>
        </div>

        <JobMonitor
          jobs={jobs}
          activeJobId={activeJobId}
          open={rightOpen}
          onToggle={() => setRightOpen((v) => !v)}
        />
      </div>

      {/* ── body: mobile ── */}
      <div className="hidden max-md:flex max-md:flex-col max-md:flex-1 pt-[52px]">
        <PlayerPane
          activeComposition={activeComposition}
          renderState={renderState}
        />
        <div className="border-t" style={{ borderColor: "var(--border)" }}>
          <RenderControls
            activeTemplate={activeTemplate}
            onTemplateChange={handleTemplateChange}
            templateParams={templateParams}
            onParamChange={handleParamChange}
            disabled={renderState.status !== "idle"}
          />
          <RenderButton
            renderState={renderState}
            activeTemplate={activeTemplate}
            templateParams={templateParams}
            onRender={handleRender}
            onReset={handleReset}
          />
        </div>

        <button
          className="hf-fab hf-fab-left"
          onClick={() => setMobileSheet("compositions")}
          aria-label="Compositions">
          {"\uD83C\uDFAC"}
        </button>
        <button
          className="hf-fab hf-fab-right"
          onClick={() => setMobileSheet("jobs")}
          aria-label="Job Monitor">
          {"\uD83D\uDCCB"}
        </button>

        <MobileSheet
          open={mobileSheet === "compositions"}
          onClose={() => setMobileSheet(null)}
          title="Compositions">
          <div className="space-y-2">
            {compositions.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No compositions
              </p>
            ) : (
              compositions.map((name) => (
                <button
                  key={name}
                  onClick={() => {
                    setActiveComposition(name);
                    setMobileSheet(null);
                  }}
                  className="w-full text-left p-3 rounded-lg text-sm font-mono transition-colors"
                  style={{
                    background:
                      name === activeComposition ? "var(--bg-elevated)" : "transparent",
                    border:
                      name === activeComposition
                        ? "1px solid var(--accent)"
                        : "1px solid var(--border)",
                    color: "var(--text-primary)",
                  }}>
                  {name}
                </button>
              ))
            )}
          </div>
        </MobileSheet>

        <MobileSheet
          open={mobileSheet === "jobs"}
          onClose={() => setMobileSheet(null)}
          title="Job Monitor">
          <div className="space-y-2">
            {jobs.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Waiting for jobs\u2026
              </p>
            ) : (
              [...jobs]
                .sort(
                  (a, b) =>
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                )
                .map((job) => (
                  <div
                    key={job.id}
                    className="rounded-lg p-3 border text-sm"
                    style={{
                      background: "var(--bg-elevated)",
                      borderColor: "var(--border)",
                    }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs">{job.id.slice(0, 8)}</span>
                      <StatusBadge status={job.status} />
                    </div>
                    <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                      {job.composition}
                    </div>
                    {job.status === "done" && job.url && (
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs mt-1 inline-block"
                        style={{ color: "var(--accent)" }}>
                        {"\u2B07"} MP4
                      </a>
                    )}
                    {job.status === "failed" && job.error && (
                      <p className="text-xs mt-1" style={{ color: "var(--error)" }}>
                        {job.error}
                      </p>
                    )}
                  </div>
                ))
            )}
          </div>
        </MobileSheet>
      </div>
    </div>
  );
}
