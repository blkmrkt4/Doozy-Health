"use client";

import { useState } from "react";
import Link from "next/link";

// Client component for the PDF export config. Handles the download via
// fetch to /api/report and triggers a file download.

const inputCls =
  "block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent";

export function ReportForm({
  patientId,
  patientName,
}: {
  patientId: string;
  patientName: string;
}) {
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
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, from, to }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        setError(
          (body as { error?: string }).error ??
            `PDF generation failed (${res.status}). Try the HTML report instead.`
        );
        return;
      }

      // Trigger download.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ??
        `Doozy Health — ${patientName} — ${from} to ${to}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(
        "PDF generation requires Chromium on the server. " +
          "Use the HTML report link below and print to PDF from your browser."
      );
    } finally {
      setGenerating(false);
    }
  }

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
          <span className="text-sm text-muted">{patientName}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 space-y-6">
        <h1 className="text-xl font-medium tracking-tight">Export report</h1>
        <p className="text-sm text-faint">
          Generate a report for your doctor. Choose a date range, then
          download the PDF or view the HTML report.
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
              className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {generating ? "Generating..." : "Download PDF"}
            </button>
            <Link
              href={`/report/${patientId}?from=${from}&to=${to}`}
              className="rounded-md border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-surface"
            >
              View HTML report
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
