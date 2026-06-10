import type { Frequency } from "@/lib/types";

// Supply / run-out projection (PRD §5.3). Deterministic TypeScript, no LLM:
// given how much is in the package, the chosen cadence, and what's actually been
// logged, work out how much is left and roughly when it runs out. Logged-dose
// based — under-dosing pushes the date out, over-dosing pulls it in. Always an
// estimate, shown neutrally (a record, never "refill now").

export type Conc = {
  amount: number;
  unit: string;
  per_volume: number;
  volume_unit: string;
} | null;

const COUNT_UNITS = new Set([
  "tablet", "tablets", "capsule", "capsules", "pill", "pills",
]);
const norm = (u: string | null | undefined) => (u ?? "").trim().toLowerCase();

/** Doses per day implied by a structured cadence; null for as-needed (no steady
 *  rate, so no date can be projected). */
export function dosesPerDay(f: Frequency): number | null {
  if (f.type === "as_needed") return null;
  if (f.type === "every") {
    const perDay: Record<string, number> = { hour: 24, day: 1, week: 1 / 7, month: 1 / 30 };
    const base = perDay[f.unit];
    return base && f.interval > 0 ? base / f.interval : null;
  }
  const perDay = f.period === "week" ? 1 / 7 : 1;
  return f.count > 0 ? f.count * perDay : null;
}

/** Convert one dose (amount in doseUnit) into package units (tablets, mL, …),
 *  using the strength/concentration when the units differ. null if it can't be
 *  expressed in package units (so we don't guess). */
export function packageUnitsPerDose(
  amount: number,
  doseUnit: string,
  packageUnit: string | null,
  conc: Conc
): number | null {
  if (!(amount > 0)) return null;
  const du = norm(doseUnit);
  const pu = norm(packageUnit);
  if (!pu) return null;

  // Already in package units: count↔count (tablet/tablets) or same unit (mL↔mL).
  if (du === pu) return amount;
  if (COUNT_UNITS.has(du) && COUNT_UNITS.has(pu)) return amount;

  // Mass/IU dose → package units via the strength (amount per one package unit).
  if (conc && conc.amount > 0 && conc.per_volume > 0 && du === norm(conc.unit)) {
    return (amount * conc.per_volume) / conc.amount;
  }
  return null;
}

/** Sum logged consumption (in package units) from taken/prn logs, each carrying
 *  its own unit (falling back to the regimen's dose unit). */
export function consumedFromLogs(
  logs: { amount: number | string | null; unit?: string | null }[],
  fallbackDoseUnit: string,
  packageUnit: string | null,
  conc: Conc
): number {
  let total = 0;
  for (const l of logs) {
    const amt = Number(l.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const units = packageUnitsPerDose(amt, l.unit || fallbackDoseUnit, packageUnit, conc);
    if (units != null) total += units;
  }
  return total;
}

export type RunOut = {
  /** package units left now (never below zero) */
  remaining: number;
  packageUnit: string;
  /** package units consumed per day at the chosen cadence; null if no rate */
  unitsPerDay: number | null;
  daysLeft: number | null;
  runOutAt: Date | null;
  ranOut: boolean;
};

/** Project remaining supply + a run-out date. Returns null when there's no
 *  package count to work from (nothing to show). */
export function projectRunOut(opts: {
  packageCount: number;
  packageUnit: string | null;
  concentration: Conc;
  regimen: { doseAmount: number; doseUnit: string; frequency: Frequency } | null;
  consumed: number;
  now: number;
}): RunOut | null {
  if (!(opts.packageCount > 0)) return null;
  const packageUnit = (opts.packageUnit ?? "").trim() || "units";
  const remaining = Math.max(0, opts.packageCount - Math.max(0, opts.consumed));

  let unitsPerDay: number | null = null;
  if (opts.regimen) {
    const perDose = packageUnitsPerDose(
      opts.regimen.doseAmount,
      opts.regimen.doseUnit,
      opts.packageUnit,
      opts.concentration
    );
    const dpd = dosesPerDay(opts.regimen.frequency);
    if (perDose != null && dpd != null && dpd > 0) unitsPerDay = perDose * dpd;
  }

  if (remaining <= 0) {
    return { remaining: 0, packageUnit, unitsPerDay, daysLeft: 0, runOutAt: new Date(opts.now), ranOut: true };
  }

  let daysLeft: number | null = null;
  let runOutAt: Date | null = null;
  if (unitsPerDay && unitsPerDay > 0) {
    daysLeft = remaining / unitsPerDay;
    runOutAt = new Date(opts.now + daysLeft * 86_400_000);
  }
  return { remaining, packageUnit, unitsPerDay, daysLeft, runOutAt, ranOut: false };
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** A neutral, factual one-liner — never directive. "~64 tablets left · runs out
 *  around Aug 12". Just the count when there's no steady rate (PRN). */
export function formatRunOut(r: RunOut, now: number): string {
  const qty = `${Math.round(r.remaining * 10) / 10} ${r.packageUnit}`;
  if (r.ranOut) return "Supply used up, based on what you've logged";
  if (!r.runOutAt) return `~${qty} left`;
  const d = r.runOutAt;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const date = `${MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? "" : `, ${d.getFullYear()}`}`;
  return `~${qty} left · runs out around ${date}`;
}
