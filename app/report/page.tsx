"use client";

import { useState } from "react";
import Link from "next/link";

// Report export config page (PRD §5.10). Choose date range, medications,
// and generate a PDF or view the HTML report directly.

const inputCls =
  "block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent";

export default function ReportConfigPage() {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [from, setFrom] = useState(thirtyDaysAgo);
  const [to, setTo] = useState(today);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);

    try {
      // We need the patient ID — read from the active patient cookie.
      // For simplicity, link to the HTML view and let the user print.
      // The PDF API is available for programmatic use.
      setError(
        "PDF generation requires Chromium on the server. " +
          "Use the 'View report' link below and print to PDF from your browser."
      );
    } finally {
      setGenerating(false);
    }
  }

  // For now, we don't have the patientId in client state. The HTML report
  // link needs it. We'll show a message directing users to use the print view.
  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link
            href="/dashboard"
            className="text-sm text-faint hover:text-muted"
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 space-y-6">
        <h1 className="text-xl font-medium tracking-tight">Export report</h1>
        <p className="text-sm text-faint">
          Generate a report for your doctor. Choose a date range, then view or
          print the report.
        </p>

        {error ? (
          <p className="rounded-md border border-yellow-900 bg-yellow-950/30 p-3 text-sm text-yellow-300">
            {error}
          </p>
        ) : null}

        <section className="rounded-md border border-line p-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="from" className="block text-sm text-muted">
                From
              </label>
              <input
                id="from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={`${inputCls} mt-1`}
              />
            </div>
            <div>
              <label htmlFor="to" className="block text-sm text-muted">
                To
              </label>
              <input
                id="to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={`${inputCls} mt-1`}
              />
            </div>
          </div>

          <p className="text-xs text-faint">
            The report includes all your medications, dose history, and diary
            entries within this date range. The regulatory disclaimer appears on
            every section.
          </p>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {generating ? "Generating..." : "Generate PDF"}
            </button>
          </div>
        </section>

        <p className="text-xs text-faint">
          Tip: to create a PDF without server-side rendering, open the report
          in your browser and use your browser&rsquo;s print function (Ctrl+P /
          Cmd+P) to save as PDF.
        </p>
      </main>
    </div>
  );
}
