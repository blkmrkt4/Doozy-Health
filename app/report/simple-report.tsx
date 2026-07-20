"use client";

import { useFormStatus } from "react-dom";
import { openSimpleSnapshot } from "./actions";

// Simple mode's Doctor summary page: one button, sensible defaults (last 90
// days, written summary prepared automatically). The full builder with date
// ranges and options stays in the full view. Copy: a record the user may
// choose to share — never a "clinical record" (PRD §6.1).

function PrepareButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="block w-full rounded-xl bg-accent px-6 py-4 text-center text-lg font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-60"
      style={{ minHeight: 64 }}
    >
      {pending ? "Preparing…" : "Prepare printable summary"}
    </button>
  );
}

export function SimpleReport({ patientName }: { patientName: string }) {
  return (
    <div className="min-h-full">
      <main className="mx-auto max-w-2xl px-5 py-10">
        <h1 className="text-3xl font-medium tracking-tight text-paper">
          Doctor summary
        </h1>
        <p className="mt-3 text-lg text-muted">
          A printable record of{" "}
          <span className="text-paper blur-private">{patientName}</span>&rsquo;s
          medications and logged doses from the last 90 days, to bring to an
          appointment.
        </p>
        <form action={openSimpleSnapshot} className="mt-8">
          <PrepareButton />
        </form>
        <p className="mt-4 text-sm text-faint">
          Preparing the written summary can take a moment. On the next page, use
          &ldquo;Save as PDF&rdquo; to print or share it.
        </p>
      </main>
    </div>
  );
}
