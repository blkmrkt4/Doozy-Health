"use client";

import { useState } from "react";
import Link from "next/link";

// Dismissible diary-template suggestion shown right after a medication is added
// (PRD §5.9.1). Non-directive: an offer of things people commonly track, never
// a prescription. Dismissal is session-level — the prompt only appears on the
// just-added (?new=1) view, so no persistence is needed.
export function TemplateSuggestion({
  medicationId,
  templateId,
  templateName,
}: {
  medicationId: string;
  templateId: string;
  templateName: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-paper">
            Track what people often watch with this
          </p>
          <p className="mt-0.5 text-sm text-muted">
            People taking this kind of medication often keep an eye on a handful
            of things over time. Want to start with the &ldquo;{templateName}
            &rdquo; set? You choose what to keep — nothing is added until you
            confirm.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <Link
              href={`/settings/tracking/templates/${templateId}?medication_id=${medicationId}`}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
            >
              See the fields
            </Link>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-sm text-faint hover:text-muted"
            >
              No thanks
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="shrink-0 text-lg leading-none text-faint hover:text-paper"
        >
          ×
        </button>
      </div>
    </section>
  );
}
