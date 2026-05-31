"use client";

import { type StudioForm, type StylePreset, type AspectFormat, type AnimationIntensity } from "./studio-reducer";

interface Props {
  form: StudioForm;
  onChange: (patch: Partial<StudioForm>) => void;
  onGenerate: () => void;
  disabled: boolean;
}

const STYLE_OPTIONS: { value: StylePreset; label: string }[] = [
  { value: "cinematic", label: "Cinematic" },
  { value: "minimal", label: "Minimal" },
  { value: "vibrant", label: "Vibrant" },
  { value: "corporate", label: "Corporate" },
];

const FORMAT_OPTIONS: { value: AspectFormat; label: string }[] = [
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "1:1", label: "1:1" },
];

const INTENSITY_OPTIONS: { value: AnimationIntensity; label: string }[] = [
  { value: "subtle", label: "Subtle" },
  { value: "balanced", label: "Balanced" },
  { value: "dynamic", label: "Dynamic" },
];

function PillGroup<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="studio-field">
      <span className="studio-label">{label}</span>
      <div className="studio-pills">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`studio-pill${opt.value === value ? " active" : ""}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function StudioForm({ form, onChange, onGenerate, disabled }: Props) {
  return (
    <form
      className="studio-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onGenerate();
      }}
    >
      <div className="studio-field">
        <label className="studio-label" htmlFor="prompt">
          Prompt
        </label>
        <textarea
          id="prompt"
          className="studio-input studio-textarea"
          placeholder="Describe your video…"
          rows={3}
          value={form.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          disabled={disabled}
        />
      </div>

      <PillGroup
        label="Style"
        options={STYLE_OPTIONS}
        value={form.style}
        onChange={(v) => onChange({ style: v })}
      />

      <div className="studio-field">
        <label className="studio-label" htmlFor="duration">
          Duration: <strong>{form.duration}s</strong>
        </label>
        <input
          id="duration"
          type="range"
          className="studio-range"
          min={3}
          max={60}
          step={1}
          value={form.duration}
          onChange={(e) => onChange({ duration: Number(e.target.value) })}
          disabled={disabled}
        />
        <div className="studio-range-labels">
          <span>3s</span>
          <span>60s</span>
        </div>
      </div>

      <PillGroup
        label="Format"
        options={FORMAT_OPTIONS}
        value={form.format}
        onChange={(v) => onChange({ format: v })}
      />

      <PillGroup
        label="Animation"
        options={INTENSITY_OPTIONS}
        value={form.intensity}
        onChange={(v) => onChange({ intensity: v })}
      />

      <div className="studio-field studio-toggle-row">
        <label className="studio-label" htmlFor="subtitles">
          Subtitles
        </label>
        <button
          type="button"
          id="subtitles"
          role="switch"
          aria-checked={form.subtitles}
          className={`studio-toggle${form.subtitles ? " on" : ""}`}
          onClick={() => onChange({ subtitles: !form.subtitles })}
          disabled={disabled}
        >
          <span className="studio-toggle-knob" />
        </button>
      </div>

      <button
        type="submit"
        className="studio-generate-btn"
        disabled={disabled || !form.prompt.trim()}
      >
        {disabled ? "Generating…" : "Generate Video"}
      </button>
    </form>
  );
}
