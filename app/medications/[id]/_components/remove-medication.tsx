"use client";

import { useState } from "react";
import { archiveMedication, deleteMedication } from "@/app/medications/actions";

// Remove-medication control (PRD §5.6). Tapping "Remove" opens an in-app
// confirm (never the native window.confirm) that offers two paths and explains
// the difference: Archive keeps the history and lets it come back; Delete is
// permanent and pulls it from charts and the clinician report. When there's
// logged history, archiving is presented as the safer default. American English.

export function RemoveMedicationControls({
  medicationId,
  doseCount,
}: {
  medicationId: string;
  doseCount: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const hasHistory = doseCount > 0;
  const doseLabel = `${doseCount} dose${doseCount === 1 ? "" : "s"}`;

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-surface"
      >
        Remove…
      </button>
    );
  }

  return (
    <div className="w-full max-w-md rounded-md border border-line bg-surface p-4 space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-paper">
          Are you sure you want to delete?
        </p>
        <p className="text-xs leading-relaxed text-muted">
          {hasHistory
            ? `You've logged ${doseLabel} for this medication. Deleting is permanent — it erases this medication and all of its logged doses, and removes it from your charts and from any report you generate for your doctor. If you just want it off your list, archive it instead.`
            : `Deleting is permanent — it removes this medication and anything logged against it from your charts and reports. If you might use it again, archive it instead.`}
        </p>
      </div>

      <div className="rounded-md border border-line p-3 space-y-2">
        <p className="text-xs text-faint">
          <span className="font-medium text-muted">Archive</span> keeps the
          history and hides the medication from your list. You can add it back
          anytime.
        </p>
        <form action={archiveMedication}>
          <input type="hidden" name="medication_id" value={medicationId} />
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
          >
            Archive{hasHistory ? " (recommended)" : ""}
          </button>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form action={deleteMedication}>
          <input type="hidden" name="medication_id" value={medicationId} />
          <button
            type="submit"
            className="rounded-md border px-4 py-2 text-sm font-medium transition-colors"
            style={{
              borderColor: "var(--color-danger-line)",
              color: "var(--color-danger-text)",
              backgroundColor: "var(--color-danger-bg)",
            }}
          >
            Delete permanently
          </button>
        </form>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-sm text-faint underline transition-colors hover:text-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
