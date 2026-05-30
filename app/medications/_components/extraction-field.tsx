"use client";

// Extraction review field with per-field confidence indicator (PRD §5.2.1).
// Confidence colours: high = green, medium = yellow, low = red.

import type { LlmConfidence } from "@/lib/types";

const CONFIDENCE_STYLES: Record<LlmConfidence, { border: string; badge: string; label: string }> = {
  high: {
    border: "border-green-800",
    badge: "bg-green-950 text-green-400",
    label: "high",
  },
  medium: {
    border: "border-yellow-800",
    badge: "bg-yellow-950 text-yellow-400",
    label: "medium",
  },
  low: {
    border: "border-red-800",
    badge: "bg-red-950 text-red-400",
    label: "low",
  },
};

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
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${style.badge}`}
        >
          {style.label}
        </span>
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
