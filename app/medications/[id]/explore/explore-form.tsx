"use client";

import { useState } from "react";
import Link from "next/link";
import { PkChart } from "@/app/medications/[id]/timeline/pk-chart";
import {
  computeConcentration,
  generateScheduledDoses,
  type PkParams,
  type PkTimeSeries,
} from "@/lib/pharmacokinetics";
import type { KernelType } from "@/lib/drug-catalogue";

// Regimen explorer client form (PRD §4.9). User constructs a hypothetical
// regimen, sees the curve shape. Like a calculator, not an adviser.
// No ranking, no "better", no recommendation, no write-back.

const MS_PER_HOUR = 3_600_000;
const DAY_MS = 24 * MS_PER_HOUR;

const inputCls =
  "block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent";

const KERNELS: { value: KernelType; label: string }[] = [
  { value: "bateman", label: "Bateman (oral / depot IM)" },
  { value: "exponential", label: "Exponential (IV-like)" },
  { value: "zeroOrder", label: "Zero-order (patch / implant)" },
];

export function ExploreForm({
  medicationId,
  medicationName,
  defaults,
}: {
  medicationId: string;
  medicationName: string;
  defaults: {
    doseAmount: string;
    intervalDays: string;
    halfLife: string;
    bioavailability: string;
    tmax: string;
    kernel: string;
  };
}) {
  const [doseAmount, setDoseAmount] = useState(defaults.doseAmount);
  const [intervalDays, setIntervalDays] = useState(defaults.intervalDays);
  const [halfLife, setHalfLife] = useState(defaults.halfLife);
  const [bioavailability, setBioavailability] = useState(defaults.bioavailability);
  const [tmax, setTmax] = useState(defaults.tmax);
  const [kernel, setKernel] = useState(defaults.kernel);
  const [series, setSeries] = useState<PkTimeSeries | null>(null);

  function compute() {
    const amount = Number(doseAmount);
    const interval = Number(intervalDays);
    const hl = Number(halfLife);
    const bio = Number(bioavailability);
    const tm = Number(tmax);

    if (
      !Number.isFinite(amount) || amount <= 0 ||
      !Number.isFinite(interval) || interval <= 0 ||
      !Number.isFinite(hl) || hl <= 0 ||
      !Number.isFinite(bio) || bio <= 0 || bio > 1 ||
      !Number.isFinite(tm) || tm <= 0
    ) {
      return;
    }

    const now = Date.now();
    const rangeStart = now - 14 * DAY_MS;
    const rangeEnd = now + 7 * DAY_MS;

    const params: PkParams = {
      halfLifeHours: hl,
      bioavailability: bio,
      tmaxHours: tm,
      kernel: kernel as KernelType,
      isLinear: true,
    };

    const doses = generateScheduledDoses(
      { type: "every", interval, unit: "day" },
      amount,
      rangeStart,
      rangeEnd
    );

    const result = computeConcentration(doses, params, rangeStart, rangeEnd, now);
    setSeries(result);
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link
            href={`/medications/${medicationId}/timeline`}
            className="text-sm text-faint hover:text-muted"
          >
            ← Timeline
          </Link>
          <span className="text-sm text-muted">{medicationName}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 space-y-6">
        <h1 className="text-xl font-medium tracking-tight">
          Explore a regimen
        </h1>
        <p className="text-sm text-faint">
          See the shape of a dosing schedule you are considering. This is a
          calculator, not an adviser — it shows curve shapes only and never
          recommends or ranks a regimen.
        </p>

        <section className="rounded-md border border-line p-4 space-y-4">
          <h2 className="text-sm font-medium text-paper">
            Hypothetical regimen
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-sm text-muted">Dose amount</label>
              <input
                type="number"
                step="any"
                value={doseAmount}
                onChange={(e) => setDoseAmount(e.target.value)}
                className={`${inputCls} mt-1 tabular`}
              />
            </div>
            <div>
              <label className="block text-sm text-muted">Every N days</label>
              <input
                type="number"
                step="any"
                value={intervalDays}
                onChange={(e) => setIntervalDays(e.target.value)}
                className={`${inputCls} mt-1 tabular`}
              />
            </div>
            <div>
              <label className="block text-sm text-muted">Kernel</label>
              <select
                value={kernel}
                onChange={(e) => setKernel(e.target.value)}
                className={`${inputCls} mt-1`}
              >
                {KERNELS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-sm text-muted">
                Half-life (hours)
              </label>
              <input
                type="number"
                step="any"
                value={halfLife}
                onChange={(e) => setHalfLife(e.target.value)}
                className={`${inputCls} mt-1 tabular`}
              />
            </div>
            <div>
              <label className="block text-sm text-muted">
                Bioavailability (0–1)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={bioavailability}
                onChange={(e) => setBioavailability(e.target.value)}
                className={`${inputCls} mt-1 tabular`}
              />
            </div>
            <div>
              <label className="block text-sm text-muted">Tmax (hours)</label>
              <input
                type="number"
                step="any"
                value={tmax}
                onChange={(e) => setTmax(e.target.value)}
                className={`${inputCls} mt-1 tabular`}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={compute}
            className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
          >
            Render curve
          </button>
        </section>

        {series ? (
          <div className="space-y-4">
            <PkChart series={series} />
            <p className="rounded-md border border-line bg-surface p-3 text-xs text-faint">
              This is an illustrative shape, not a prediction. It does not
              recommend or endorse any regimen. Discuss changes with your
              clinician.
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
