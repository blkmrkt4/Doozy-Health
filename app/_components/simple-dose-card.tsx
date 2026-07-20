"use client";

import { useEffect, useState, useTransition } from "react";
import { quickLogDose, quickUnlogDose } from "@/app/medications/actions";
import { buildQuickLogFormData, defaultDoseText } from "@/lib/quick-log";
import { COMPLIANCE_COLOURS } from "@/lib/colours";
import type { MedLogMeta } from "@/lib/adherence";

// Simple-mode Today card (users.display_prefs.simple_mode): one medication,
// large type, one giant "Mark as taken" button. The dose is the chosen-regimen
// amount as-is — no editing here; the full view has the editable figure.
// Optimistic like MedDoseRow, sharing the same FormData contract via
// lib/quick-log so the two paths cannot drift. Copy records, never instructs
// (PRD §6.1): "Mark as taken", never "Time to take". No celebration on
// completion (hard rule #14).

const GREEN = COMPLIANCE_COLOURS.full;

export function SimpleDoseCard({
  meta,
  scheduled,
  logged,
  logIds,
  dayMs,
  canLog,
  hasInteraction = false,
}: {
  meta: MedLogMeta;
  scheduled: number;
  logged: number;
  logIds: string[];
  dayMs: number;
  canLog: boolean;
  hasInteraction?: boolean;
}) {
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(logged);

  // Reconcile with the server count after each revalidate.
  useEffect(() => {
    setOptimistic(logged);
  }, [logged]);

  const { doseText, unitLabel } = defaultDoseText(meta);
  const complete = scheduled > 0 && optimistic >= scheduled;

  function markTaken() {
    const fd = buildQuickLogFormData({
      meta,
      doseText,
      dayMs,
      isToday: true,
    });
    if (!fd) return;
    setOptimistic((v) => v + 1);
    startTransition(() => quickLogDose(fd));
  }

  function undo() {
    if (optimistic <= 0) return;
    const idx = optimistic - 1;
    setOptimistic((v) => v - 1);
    const logId = logIds[idx];
    if (logId) {
      const fd = new FormData();
      fd.set("medication_id", meta.medId);
      fd.set("log_id", logId);
      startTransition(() => quickUnlogDose(fd));
    }
  }

  return (
    <div className="rounded-xl border border-line p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2.5 text-2xl font-medium text-paper">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: meta.colour }}
              aria-hidden
            />
            <span className="truncate blur-private">{meta.name}</span>
          </p>
          <p className="mt-1 pl-[22px] text-lg text-muted blur-private tabular">
            {doseText} {unitLabel}
            <span className="ml-2 text-faint">{meta.defaultRoute}</span>
          </p>
          {hasInteraction ? (
            <p className="mt-1 pl-[22px] text-sm text-faint">
              Known interaction with another medication — see the full view for
              details.
            </p>
          ) : null}
        </div>
        {scheduled > 1 ? (
          <p className="shrink-0 text-sm text-faint tabular">
            {Math.min(optimistic, scheduled)} of {scheduled} logged
          </p>
        ) : null}
      </div>

      {complete ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-lg font-medium" style={{ color: GREEN }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 13l4 4L19 7"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Logged
          </p>
          {canLog ? (
            <button
              type="button"
              onClick={undo}
              className="text-sm text-faint underline hover:text-muted"
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : canLog ? (
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={markTaken}
            className="block w-full rounded-xl bg-accent px-6 py-4 text-center text-lg font-medium text-on-accent transition-opacity hover:opacity-90"
            style={{ minHeight: 64 }}
          >
            Mark as taken
          </button>
          {optimistic > 0 ? (
            <button
              type="button"
              onClick={undo}
              className="text-sm text-faint underline hover:text-muted"
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : (
        // Viewers read the record; they never write (PRD §5.6).
        <p className="mt-4 text-sm text-faint">
          {scheduled > 0
            ? `${Math.min(optimistic, scheduled)} of ${scheduled} logged today`
            : optimistic > 0
              ? `${optimistic} logged today`
              : "Nothing logged today"}
        </p>
      )}
    </div>
  );
}
