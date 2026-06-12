"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { generateClinicalSummary } from "./actions";

// Report export config (PRD §5.10, §5.10.1). The report is viewed in the
// browser — as the styled HTML report or a plain-text version — not downloaded
// as a PDF. Both views read the cached written summary; if it hasn't been
// generated for the chosen dates, we offer to generate it first so the reader
// gets an informed analysis rather than a bare diary of what was logged.

const inputCls =
  "block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent";

/** "13th", "1st", "2nd", "3rd" — ordinal suffix for a day of the month. */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** "Wednesday, May 13th, 2026" — a full, easy-to-read date (PRD §9 clarity). */
function readableDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return "";
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const month = d.toLocaleDateString("en-US", { month: "long" });
  return `${weekday}, ${month} ${ordinal(d.getDate())}, ${d.getFullYear()}`;
}

export function ReportForm({
  patientId,
  patientName,
  initialFrom,
  initialTo,
  initialHasSummary,
}: {
  patientId: string;
  patientName: string;
  initialFrom: string;
  initialTo: string;
  initialHasSummary: boolean;
}) {
  const router = useRouter();

  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [includeFullLog, setIncludeFullLog] = useState(false);

  // Whether a written summary is known to exist for the *current* range. True on
  // load if one was cached for the default range; cleared whenever the dates
  // change (we can't be sure for a new range) and set after a generation.
  const [summaryReady, setSummaryReady] = useState(initialHasSummary);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryDone, setSummaryDone] = useState(initialHasSummary);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // When set, the "generate the summary first?" prompt is shown; the value is
  // the report format the user was trying to open.
  const [pending, setPending] = useState<null | "html" | "text">(null);

  const logParam = includeFullLog ? "&log=full" : "";

  function onDateChange(which: "from" | "to", value: string) {
    if (which === "from") setFrom(value);
    else setTo(value);
    setSummaryReady(false);
    setSummaryDone(false);
    setSummaryError(null);
  }

  function urlFor(format: "html" | "text"): string {
    const base = format === "text" ? `/report/${patientId}/text` : `/report/${patientId}`;
    return `${base}?from=${from}&to=${to}${logParam}`;
  }

  /** Generate the summary; returns true on success. */
  async function generateSummary(): Promise<boolean> {
    setSummarizing(true);
    setSummaryError(null);
    try {
      const res = await generateClinicalSummary(patientId, from, to);
      if (res.ok) {
        setSummaryDone(true);
        setSummaryReady(true);
        return true;
      }
      setSummaryError(res.error);
      return false;
    } catch {
      setSummaryError("Could not generate the summary. Please try again.");
      return false;
    } finally {
      setSummarizing(false);
    }
  }

  function openReport(format: "html" | "text") {
    if (summaryReady) router.push(urlFor(format));
    else setPending(format);
  }

  async function generateThenView() {
    const ok = await generateSummary();
    if (ok && pending) {
      const target = pending;
      setPending(null);
      router.push(urlFor(target));
    }
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-sm text-faint hover:text-muted">
            ← Dashboard
          </Link>
          <span className="text-sm text-muted">{patientName}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 space-y-6">
        <h1 className="text-xl font-medium tracking-tight">Health snapshot</h1>
        <p className="text-sm text-faint">
          A snapshot to share with your doctor, coach, or practitioner. Choose a
          date range, generate the written summary, then view it as a web page or
          as plain text.
        </p>

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
                onChange={(e) => onDateChange("from", e.target.value)}
                className={`${inputCls} mt-1`}
              />
              <p className="mt-1.5 text-xs text-faint">{readableDate(from)}</p>
            </div>
            <div>
              <label htmlFor="to" className="block text-sm text-muted">
                To
              </label>
              <input
                id="to"
                type="date"
                value={to}
                onChange={(e) => onDateChange("to", e.target.value)}
                className={`${inputCls} mt-1`}
              />
              <p className="mt-1.5 text-xs text-faint">{readableDate(to)}</p>
            </div>
          </div>

          <p className="text-xs text-faint">
            The report includes all your medications, an analysis of your dosing
            and tracked measures, and charts within this date range. The
            regulatory disclaimer appears on every section.
          </p>

          {/* ── Written summary (PRD §5.10.1) ───────────────────────────── */}
          <div className="rounded-md border border-line bg-surface/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-paper">Written summary</p>
                <p className="text-xs text-faint">
                  {summaryDone
                    ? "Ready — included in the report below."
                    : "An analysis of dosing, tracked measures, and how they moved together."}
                </p>
              </div>
              <button
                type="button"
                onClick={generateSummary}
                disabled={summarizing}
                className="shrink-0 rounded-md border border-accent px-3 py-2 text-sm font-medium text-accent transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {summarizing ? "Writing…" : summaryDone ? "Regenerate" : "Generate summary"}
              </button>
            </div>
            {summaryError ? (
              <p className="text-xs text-yellow-300">{summaryError}</p>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={includeFullLog}
              onChange={(e) => setIncludeFullLog(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            Include the full dose log as an appendix
          </label>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => openReport("html")}
              className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
            >
              View HTML report
            </button>
            <button
              type="button"
              onClick={() => openReport("text")}
              className="rounded-md border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-surface"
            >
              View text report
            </button>
          </div>
        </section>
      </main>

      {/* ── "Generate the summary first?" prompt ──────────────────────────── */}
      {pending ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-prompt-title"
        >
          <div className="w-full max-w-md rounded-lg border border-line bg-surface p-5 shadow-xl">
            <h2 id="report-prompt-title" className="text-base font-medium text-paper">
              Add the written summary first?
            </h2>
            <p className="mt-2 text-sm text-muted">
              You haven&rsquo;t created the written summary for these dates yet.
              Without it, the report is just a plain diary — a list of the doses
              and entries you logged, with no analysis.
            </p>
            <p className="mt-2 text-sm text-muted">
              Adding the summary gives the reader a clear overview that ties your
              medications to how you&rsquo;ve been tracking and feeling. It takes
              a few seconds.
            </p>
            {summaryError ? (
              <p className="mt-3 text-xs text-yellow-300">{summaryError}</p>
            ) : null}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setPending(null);
                  setSummaryError(null);
                }}
                className="rounded-md px-3 py-2 text-sm text-faint transition-colors hover:text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = pending;
                  setPending(null);
                  if (target) router.push(urlFor(target));
                }}
                className="rounded-md border border-line px-3 py-2 text-sm text-muted transition-colors hover:bg-surface"
              >
                View plain report
              </button>
              <button
                type="button"
                onClick={generateThenView}
                disabled={summarizing}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {summarizing ? "Writing…" : "Generate, then view"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
