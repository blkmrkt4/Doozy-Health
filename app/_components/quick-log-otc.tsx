"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { logSingleUseDose } from "@/app/medications/actions";

// Quick-log a one-off / OTC medication (PRD §5.10.1 Phase B): Tylenol, ibuprofen,
// NyQuil — things not in the regular inventory. It resolves to a canonical drug
// server-side so it feeds the curated interaction check + the Snapshot, without
// cluttering the medications list. Owners + caregivers only (the action and the
// RPC both enforce it). American English.

const UNITS = ["mg", "mcg", "g", "mL", "tablet", "capsule"];

const COMMON = [
  "Tylenol", "Acetaminophen", "Ibuprofen", "Advil", "Aleve", "Naproxen",
  "Aspirin", "NyQuil", "DayQuil", "Benadryl", "Sudafed", "Melatonin",
];

export function QuickLogOtc() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await logSingleUseDose(formData);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch {
      setError("Could not log this medication. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-line px-3 py-2 text-sm text-muted transition-colors hover:bg-surface"
      >
        + Log a one-off med
      </button>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="w-full rounded-md border border-line bg-surface/40 p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-paper">Log a one-off medication</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-faint hover:text-muted"
        >
          Cancel
        </button>
      </div>
      <p className="text-xs text-faint">
        For something you took once that isn&rsquo;t in your list — e.g. Tylenol or
        ibuprofen. It&rsquo;s included in your snapshot and interaction check.
      </p>

      <input
        name="name"
        list="otc-common"
        placeholder="Medication (e.g. Tylenol)"
        autoComplete="off"
        className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent"
      />
      <datalist id="otc-common">
        {COMMON.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="grid grid-cols-2 gap-3">
        <input
          name="amount"
          type="number"
          step="any"
          min="0"
          placeholder="Amount"
          className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent"
        />
        <select
          name="unit"
          defaultValue="mg"
          className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent"
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>

      <input
        name="logged_at"
        type="datetime-local"
        className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent"
      />
      <input
        name="note"
        placeholder="Note (optional)"
        className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent"
      />

      {error ? <p className="text-xs text-yellow-300">{error}</p> : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Logging…" : "Log it"}
      </button>
    </form>
  );
}
