"use client";

import { useState, useTransition, type Ref } from "react";
import { usePathname } from "next/navigation";
import { quickSaveDiaryField, saveDiaryNote } from "@/app/diary/actions";
import { COMPLIANCE_COLOURS } from "@/lib/colours";
import type { TrackedField, DiaryEntry, DiaryFieldValue } from "@/lib/types";

// Per-day "Diary" twisty for the calendar agenda (PRD §5.9). Every active field
// renders as a tap-through control; answers save optimistically (no reload).
// A free-text note is the only keyboard field. American English.

const ACCENT = "var(--color-accent)";

const chipBase =
  "rounded-full border px-2.5 py-1 text-xs transition-colors cursor-pointer select-none";

export function DiaryDayForm({
  dayDate,
  fields,
  entry,
  medNames,
  canLog,
  detailsRef,
}: {
  dayDate: string;
  fields: TrackedField[];
  entry: DiaryEntry | null;
  medNames: Record<string, string>;
  canLog: boolean;
  // Lets the agenda open + scroll to this twisty from a med row's diary icon.
  detailsRef?: Ref<HTMLDetailsElement>;
}) {
  const path = usePathname() ?? "/dashboard";
  const [, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, DiaryFieldValue>>(
    (entry?.field_values as Record<string, DiaryFieldValue>) ?? {}
  );
  const [note, setNote] = useState(entry?.note ?? "");

  function save(fieldId: string, value: DiaryFieldValue) {
    setValues((v) => ({ ...v, [fieldId]: value }));
    if (!canLog) return;
    const fd = new FormData();
    fd.set("day_date", dayDate);
    fd.set("field_id", fieldId);
    fd.set("value_json", JSON.stringify(value));
    fd.set("path", path);
    startTransition(() => quickSaveDiaryField(fd));
  }

  function commitNote() {
    if (!canLog) return;
    const fd = new FormData();
    fd.set("day_date", dayDate);
    fd.set("note", note);
    fd.set("path", path);
    startTransition(() => saveDiaryNote(fd));
  }

  function tag(field: TrackedField): string | null {
    const ids = field.medicationIds ?? [];
    if (ids.length === 0) return null;
    const names = ids.map((id) => medNames[id]).filter(Boolean);
    return names.length ? names.join(", ") : null;
  }

  function control(field: TrackedField) {
    const v = values[field.id];
    const disabled = !canLog;

    if (field.field_type === "scale_1_10") {
      return (
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
            const on = v === n;
            return (
              <button
                key={n}
                type="button"
                disabled={disabled}
                onClick={() => save(field.id, on ? null : n)}
                className={`${chipBase} tabular`}
                style={
                  on
                    ? { background: ACCENT, color: "var(--color-on-accent)", borderColor: ACCENT }
                    : { borderColor: "var(--color-line)", color: "var(--color-muted)" }
                }
              >
                {n}
              </button>
            );
          })}
        </div>
      );
    }

    if (field.field_type === "boolean") {
      return (
        <div className="flex gap-1.5">
          {[
            { label: "Yes", val: true },
            { label: "No", val: false },
          ].map((o) => {
            const on = v === o.val;
            return (
              <button
                key={o.label}
                type="button"
                disabled={disabled}
                onClick={() => save(field.id, on ? null : o.val)}
                className={chipBase}
                style={
                  on
                    ? { background: ACCENT, color: "var(--color-on-accent)", borderColor: ACCENT }
                    : { borderColor: "var(--color-line)", color: "var(--color-muted)" }
                }
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }

    if (field.field_type === "category") {
      return (
        <div className="flex flex-wrap gap-1.5">
          {(field.category_options ?? []).map((opt) => {
            const on = v === opt;
            return (
              <button
                key={opt}
                type="button"
                disabled={disabled}
                onClick={() => save(field.id, on ? null : opt)}
                className={chipBase}
                style={
                  on
                    ? { background: ACCENT, color: "var(--color-on-accent)", borderColor: ACCENT }
                    : { borderColor: "var(--color-line)", color: "var(--color-muted)" }
                }
              >
                {opt}
              </button>
            );
          })}
        </div>
      );
    }

    if (field.field_type === "multiselect") {
      const arr = Array.isArray(v) ? (v as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1.5">
          {(field.category_options ?? []).map((opt) => {
            const on = arr.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                disabled={disabled}
                onClick={() =>
                  save(
                    field.id,
                    on ? arr.filter((x) => x !== opt) : [...arr, opt]
                  )
                }
                className={chipBase}
                style={
                  on
                    ? { background: COMPLIANCE_COLOURS.full, color: "var(--color-on-accent)", borderColor: COMPLIANCE_COLOURS.full }
                    : { borderColor: "var(--color-line)", color: "var(--color-muted)" }
                }
              >
                {opt}
              </button>
            );
          })}
        </div>
      );
    }

    // number / freetext — the keyboard cases.
    return (
      <input
        type={field.field_type === "number" ? "number" : "text"}
        step="any"
        disabled={disabled}
        defaultValue={v != null ? String(v) : ""}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          if (field.field_type === "number") {
            const n = Number(raw);
            save(field.id, raw && Number.isFinite(n) ? n : null);
          } else {
            save(field.id, raw || null);
          }
        }}
        className="w-40 rounded-md border border-line bg-surface px-2 py-1 text-sm tabular text-paper outline-none focus:border-accent"
      />
    );
  }

  return (
    <details ref={detailsRef} className="mt-3 scroll-mt-4 rounded-md border border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2 text-sm font-medium text-paper">
        <span>Diary</span>
        <span className="text-xs text-faint">tap to open</span>
      </summary>
      <div className="space-y-4 border-t border-line p-4">
        {fields.length === 0 ? (
          <p className="text-xs text-faint">
            No tracking fields yet. Add some in Settings → Tracking.
          </p>
        ) : (
          fields.map((field) => {
            const t = tag(field);
            return (
              <div key={field.id} className="space-y-1">
                <p className="text-sm text-muted">
                  {field.name}
                  {field.unit ? <span className="ml-1 text-xs text-faint">({field.unit})</span> : null}
                  {t ? <span className="ml-2 text-[11px] text-faint">· {t}</span> : null}
                </p>
                {control(field)}
              </div>
            );
          })
        )}

        <div className="space-y-1">
          <p className="text-sm text-muted">Notes</p>
          <textarea
            rows={2}
            disabled={!canLog}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={commitNote}
            placeholder="Anything else about today…"
            className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent"
          />
        </div>
      </div>
    </details>
  );
}
