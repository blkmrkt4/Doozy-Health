"use client";

// Extraction review field with per-field confidence indicator (PRD §5.2.1).
// Confidence colours: high = green, medium = yellow, low = red. The badge
// carries a tooltip explaining what the level means — confidence is about how
// well the AI *read the label*, not about the medication itself.

import type { LlmConfidence } from "@/lib/types";

const CONFIDENCE_STYLES: Record<
  LlmConfidence,
  { border: string; badge: string; label: string; tip: string }
> = {
  high: {
    border: "border-green-800",
    badge: "bg-green-950 text-green-400",
    label: "high",
    tip: "High confidence — the AI is fairly sure it read this from the photo correctly. A quick glance is still worth it.",
  },
  medium: {
    border: "border-yellow-800",
    badge: "bg-yellow-950 text-yellow-400",
    label: "medium",
    tip: "Medium confidence — the AI is less sure it read this correctly. Please double-check it against the photo.",
  },
  low: {
    border: "border-red-800",
    badge: "bg-red-950 text-red-400",
    label: "low",
    tip: "Low confidence — the AI struggled to read this. Please verify or correct it before saving.",
  },
};

/** Look up the colour/label/tooltip for a confidence level (for reuse outside
 *  ExtractionField, e.g. controlled inputs in the form-aware dose form). */
export function confidenceStyle(confidence: LlmConfidence) {
  return CONFIDENCE_STYLES[confidence];
}

export function ExtractionField({
  label,
  name,
  value,
  confidence,
  type = "text",
  step,
}: {
  label: string;
  name: string;
  value: string;
  confidence: LlmConfidence;
  type?: "text" | "number" | "date";
  step?: string;
}) {
  const style = CONFIDENCE_STYLES[confidence];

  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={name} className="block text-sm text-muted">
          {label}
        </label>
        <ConfidenceBadge style={style} />
      </div>
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        defaultValue={value}
        className={`mt-1 block w-full rounded-md border bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent ${style.border}`}
      />
    </div>
  );
}

/**
 * Like ExtractionField but renders a <select> for enum-constrained values
 * (route, dose unit). Keeps the confidence badge + tooltip. Guarantees a valid
 * submission so a human-readable extraction ("by mouth") can't be rejected at
 * save time — the caller passes a value already mapped to a valid option.
 */
export function ExtractionSelect({
  label,
  name,
  value,
  confidence,
  options,
  placeholder,
}: {
  label: string;
  name: string;
  value: string;
  confidence: LlmConfidence;
  options: readonly { value: string; label: string }[];
  placeholder?: string;
}) {
  const style = CONFIDENCE_STYLES[confidence];

  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={name} className="block text-sm text-muted">
          {label}
        </label>
        <ConfidenceBadge style={style} />
      </div>
      <select
        id={name}
        name={name}
        defaultValue={value}
        className={`mt-1 block w-full rounded-md border bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent ${style.border}`}
      >
        {placeholder !== undefined ? (
          <option value="">{placeholder}</option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The confidence pill with an explanatory tooltip. Shows on hover (desktop)
 * and on tap/focus (mobile — touch devices can't hover), with a native `title`
 * fallback and an aria-label for screen readers.
 */
export function ConfidenceBadge({
  style,
}: {
  style: { badge: string; label: string; tip: string };
}) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        role="note"
        aria-label={`${style.label} confidence. ${style.tip}`}
        title={style.tip}
        className={`cursor-help rounded-full px-2 py-0.5 text-[10px] font-medium outline-none ring-accent focus-visible:ring-2 ${style.badge}`}
      >
        {style.label}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-10 mt-1 w-56 rounded-md border border-line bg-surface p-2 text-[11px] leading-snug text-muted opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {style.tip}
      </span>
    </span>
  );
}
