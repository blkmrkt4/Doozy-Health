"use client";

import { useState } from "react";
import { createTrackedField } from "./actions";
import { FIELD_TYPES, FIELD_TYPE_LABELS, type FieldType } from "@/lib/types";

// "Add your own" diary tracking field (PRD §5.9). Client-side so the form only
// shows the inputs a type actually needs: a unit for numbers, and an options
// list (with a + to add each, no comma-separating) for choice fields. American
// English. Posts to the createTrackedField server action.

const inputCls =
  "block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent";
const labelCls = "block text-sm text-muted";

const NEEDS_UNIT: FieldType = "number";
const NEEDS_OPTIONS = new Set<FieldType>(["category", "multiselect"]);

export function TrackedFieldForm({
  meds,
}: {
  meds: { id: string; display_name: string }[];
}) {
  const [fieldType, setFieldType] = useState<FieldType>("scale_1_10");
  const [options, setOptions] = useState<string[]>([""]);

  const needsOptions = NEEDS_OPTIONS.has(fieldType);

  return (
    <form action={createTrackedField} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>
          Name
          <input
            name="name"
            required
            placeholder="e.g. Mood, Sleep, Pain"
            className={`${inputCls} mt-1`}
          />
        </label>
        <label className={labelCls}>
          Type
          <select
            name="field_type"
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as FieldType)}
            className={`${inputCls} mt-1`}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {FIELD_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {fieldType === NEEDS_UNIT ? (
        <label className={labelCls}>
          Unit (optional)
          <input
            name="unit"
            placeholder="e.g. hours, lb, mg"
            className={`${inputCls} mt-1`}
          />
        </label>
      ) : null}

      {needsOptions ? (
        <div className="space-y-2">
          <p className={labelCls}>Choices</p>
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                name="option"
                value={opt}
                onChange={(e) =>
                  setOptions((prev) =>
                    prev.map((o, j) => (j === i ? e.target.value : o))
                  )
                }
                placeholder={`Choice ${i + 1}`}
                className={inputCls}
              />
              {options.length > 1 ? (
                <button
                  type="button"
                  aria-label="Remove choice"
                  onClick={() =>
                    setOptions((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="rounded-md border border-line px-2 py-2 text-sm text-faint hover:bg-surface"
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setOptions((prev) => [...prev, ""])}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface"
          >
            + Add a choice
          </button>
        </div>
      ) : null}

      {meds.length > 0 ? (
        <div>
          <p className={labelCls}>Applies to</p>
          <p className="mb-1 text-xs text-faint">
            Leave all unchecked to apply to every medication.
          </p>
          <div className="flex flex-wrap gap-3">
            {meds.map((m) => (
              <label
                key={m.id}
                className="flex items-center gap-1.5 text-sm text-muted"
              >
                <input
                  type="checkbox"
                  name="medication_ids"
                  value={m.id}
                  className="accent-accent"
                />
                <span className="blur-private">{m.display_name}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <button
        type="submit"
        className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
      >
        Add diary item
      </button>
    </form>
  );
}
