"use client";

import { useEffect, useState, useTransition } from "react";
import { motion, useReducedMotion } from "motion/react";
import { quickLogDose, quickUnlogDose } from "@/app/medications/actions";
import { buildQuickLogFormData, defaultDoseText } from "@/lib/quick-log";
import { COMPLIANCE_COLOURS } from "@/lib/colours";
import type { MedLogMeta } from "@/lib/adherence";

// A single streamlined agenda row: medication, an editable dose, status, and a
// right-aligned row of green check-dots — one per scheduled dose. Tap an empty
// dot to log it (animated check); tap a filled dot to undo. Optimistic, so a
// tap responds instantly on phone or desktop (PRD §5.4).

const GREEN = COMPLIANCE_COLOURS.full;

function CheckDot({
  filled,
  animate,
  reduce,
  onClick,
  disabled,
  label,
}: {
  filled: boolean;
  animate: boolean;
  reduce: boolean;
  onClick?: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={filled}
      className="flex h-6 w-6 items-center justify-center rounded-full transition-colors disabled:cursor-default"
      style={
        filled
          ? { backgroundColor: GREEN }
          : { border: `2px solid ${GREEN}`, backgroundColor: "transparent" }
      }
    >
      {filled ? (
        <motion.svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          initial={animate && !reduce ? { scale: 0.2, opacity: 0 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 22 }}
        >
          <path
            d="M5 13l4 4L19 7"
            stroke="#000"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.svg>
      ) : null}
    </button>
  );
}

export function MedDoseRow({
  meta,
  medColour,
  medName,
  scheduled,
  logged,
  logIds,
  dayMs,
  isToday,
  canLog,
  minDots = 0,
  dotsOnly = false,
  simple = false,
}: {
  meta: MedLogMeta | undefined;
  medColour: string;
  medName: string;
  scheduled: number;
  logged: number;
  logIds: string[];
  dayMs: number;
  isToday: boolean;
  canLog: boolean;
  // Always render at least this many dots, so an extra/PRN dose can be logged
  // even on a day with nothing scheduled (used on the medication detail page).
  minDots?: number;
  // Render only the check-dots (no name/dose/status) — for the dashboard cards,
  // where the name and dose already appear in the card.
  dotsOnly?: boolean;
  // Simple view: the dose shows as plain text; tapping it opens a small dialog
  // to change the amount. Tapping a green dot still just logs — no dialog.
  simple?: boolean;
}) {
  const reduce = useReducedMotion() ?? false;
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(logged);
  const [animIndex, setAnimIndex] = useState<number | null>(null);
  const [doseDialogOpen, setDoseDialogOpen] = useState(false);
  const [dialogDose, setDialogDose] = useState("");

  // Reconcile with the server count after each revalidate.
  useEffect(() => {
    setOptimistic(logged);
  }, [logged]);

  // The editable dose: mL for injectables (converted to the regimen unit on
  // log), otherwise the dose amount in its own unit.
  const plan = meta ? defaultDoseText(meta) : { doseText: "", unitLabel: "" };
  const [dose, setDose] = useState(plan.doseText);
  const doseUnitLabel = plan.unitLabel;

  const total = Math.max(scheduled, optimistic, minDots);
  const complete = optimistic >= scheduled && scheduled > 0;

  function logOne() {
    if (!meta) return;
    const fd = buildQuickLogFormData({ meta, doseText: dose, dayMs, isToday });
    if (!fd) return;

    setAnimIndex(optimistic);
    setOptimistic((v) => v + 1);
    startTransition(() => quickLogDose(fd));
  }

  function unlogOne() {
    if (!meta || optimistic <= 0) return;
    const idx = optimistic - 1;
    setOptimistic((v) => v - 1);
    setAnimIndex(null);
    // Delete the matching server log if it exists; otherwise it was an
    // optimistic-only dot not yet persisted (revalidate will settle it).
    const logId = logIds[idx];
    if (logId) {
      const fd = new FormData();
      fd.set("medication_id", meta.medId);
      fd.set("log_id", logId);
      startTransition(() => quickUnlogDose(fd));
    }
  }

  const dots = (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => {
        const filled = i < optimistic;
        return (
          <CheckDot
            key={i}
            filled={filled}
            animate={i === animIndex}
            reduce={reduce}
            disabled={!canLog || !meta}
            onClick={!canLog || !meta ? undefined : filled ? unlogOne : logOne}
            label={
              filled
                ? `Undo dose ${i + 1} of ${medName}`
                : `Log dose ${i + 1} of ${medName}`
            }
          />
        );
      })}
    </div>
  );

  if (dotsOnly) {
    return <div className="shrink-0">{dots}</div>;
  }

  return (
    // On phones (< sm) the name and the dose stack onto two lines; from sm up
    // they sit inline on one row. The check-dots stay centred on the right.
    <div className="flex items-center gap-x-2 text-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-y-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: medColour }}
            aria-hidden
          />
          <span className="truncate font-medium text-paper blur-private">{medName}</span>
        </span>

        {/* Dose + status — line two on a phone, indented to sit under the name. */}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[18px] sm:pl-0">
          {meta ? (
            <span className="flex items-center gap-1 text-muted">
              {canLog && !simple ? (
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={dose}
                  onChange={(e) => setDose(e.target.value)}
                  aria-label="Dose"
                  className="w-14 rounded-md border border-line bg-surface px-2 py-0.5 text-sm tabular text-paper outline-none focus:border-accent"
                />
              ) : canLog && simple ? (
                // Simple view: the amount is plain text; tapping it opens the
                // change-amount dialog. Logging stays a one-tap dot.
                <button
                  type="button"
                  onClick={() => {
                    setDialogDose(dose);
                    setDoseDialogOpen(true);
                  }}
                  aria-label={`Change the ${medName} amount`}
                  className="rounded-md px-1 tabular underline decoration-dotted underline-offset-4 hover:text-paper"
                >
                  {dose}
                </button>
              ) : (
                <span className="tabular">{dose}</span>
              )}
              <span>{doseUnitLabel}</span>
              <span className="text-faint">{meta.defaultRoute}</span>
            </span>
          ) : null}

          <span className={`text-xs ${complete ? "" : "text-faint"}`} style={complete ? { color: GREEN } : undefined}>
            {complete ? "complete" : `${optimistic} of ${scheduled}`}
          </span>
        </span>
      </div>

      <div className="ml-auto shrink-0">{dots}</div>

      {/* Simple-view change-amount dialog. Only affects doses logged after
          the change — exactly like editing the inline figure in the full view. */}
      {doseDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Change the ${medName} amount`}
          onClick={() => setDoseDialogOpen(false)}
        >
          <div
            className="w-full max-w-xs rounded-lg border border-line bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-medium text-paper blur-private">{medName}</p>
            <label className="mt-3 block text-sm text-muted" htmlFor={`dose-dialog-${meta?.medId}`}>
              Amount to record per dose
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id={`dose-dialog-${meta?.medId}`}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                autoFocus
                value={dialogDose}
                onChange={(e) => setDialogDose(e.target.value)}
                className="w-24 rounded-md border border-line bg-ink px-3 py-2 text-base tabular text-paper outline-none focus:border-accent"
              />
              <span className="text-base text-muted">{doseUnitLabel}</span>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDoseDialogOpen(false)}
                className="rounded-md px-3 py-2 text-sm text-faint hover:text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const n = Number(dialogDose);
                  if (Number.isFinite(n) && n > 0) {
                    setDose(dialogDose);
                    setDoseDialogOpen(false);
                  }
                }}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
