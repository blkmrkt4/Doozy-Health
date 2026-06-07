// Amount-in-system PK display maths (PRD §5.7; chart-guidance.md).
//
// Pure, deterministic, no LLM, no React, no I/O — given a drug's PK parameters
// and a list of dose events it produces the numbers a chart draws. The kernels
// are ported verbatim from the reference implementation
// (chart-guidance.html) and generalized to any medication via the typed
// contract below. Work in the drug's native unit throughout; never assume mg.

// ── Data contract (chart-guidance.md §3) ────────────────────────────────────

export type Route =
  | "oral"
  | "sublingual"
  | "intramuscular"
  | "subcutaneous"
  | "transdermal"
  | "suppository"
  | "topical"
  | "inhaled"
  | "intravenous";

export type PkModel = "amount_in_system" | "serum_bateman" | "zero_order";

export interface DrugPK {
  name: string;
  route: Route;
  /** native unit: "mg" | "mcg" | "IU" | "units" | … */
  unit: string;
  /** route-specific terminal / elimination half-life, in days */
  halfLifeDays: number;
  /** population range → uncertainty ribbon */
  halfLifeRangeDays?: [number, number];
  /** linearity gate; false ⇒ no curve, show the honest panel (§4.7) */
  isLinear: boolean;
  model?: PkModel;
  tmaxDays?: number;
  bioavailability?: number;
  releaseDurationDays?: number;
  provenance?: "curated" | "llm_extracted" | "llm_estimated" | "user_calibrated";
  confidence?: "high" | "medium" | "low";
}

export interface DoseEvent {
  /** days from the chart's time origin */
  t: number;
  /** native units actually administered (catch-up = larger amount) */
  amount: number;
  /** false = scheduled-but-missed (hollow tick, omitted from the sum) */
  taken: boolean;
  /** optional explicit catch-up/overdose flag; otherwise derived from perDose */
  big?: boolean;
}

export interface PrescribedRegimen {
  perDose: number;
  /** interval between prescribed doses in days (e.g. 7/3 ≈ 2.33 for 3×/week) */
  intervalDays: number;
  /** e.g. 200 mg/week — the input reference line */
  perPeriodDose?: number;
  /** e.g. "200 mg = one week's dose (what goes in)" */
  perPeriodLabel?: string;
}

export interface SamplePoint {
  t: number;
  v: number;
}

export interface SteadyState {
  trough: number;
  peak: number;
  avg: number;
  /** elimination constant used (ln2 / halfLifeDays) */
  k: number;
}

export interface AxisChoice {
  days: number;
  unitDays: number;
  unitLabel: "weeks" | "days";
  labelEvery: number;
}

// ── 4.1 Default model — amount in system (bolus superposition) ───────────────

/** Elimination constant: k = ln(2) / halfLifeDays. */
export function decayConstant(halfLifeDays: number): number {
  return Math.LN2 / halfLifeDays;
}

/**
 * amount(t) = Σ doseᵢ.amount · e^(−k·(t − doseᵢ.t))  for every TAKEN dose t≤now.
 * Each dose is added instantly and decays exponentially; missed doses are absent
 * from the sum; varying amounts (catch-up/overdose) fall out naturally.
 */
export function makeAmountFn(
  halfLifeDays: number,
  doses: DoseEvent[]
): (t: number) => number {
  const k = Math.LN2 / halfLifeDays;
  return (t) =>
    doses.reduce(
      (s, e) => (e.taken && e.t <= t ? s + e.amount * Math.exp(-k * (t - e.t)) : s),
      0
    );
}

/**
 * Sample the curve every 0.2 days, plus two points per taken dose
 * (t−ε excludes the dose, t includes it) to draw crisp vertical jumps.
 */
export function sampleSeries(
  amountFn: (t: number) => number,
  doses: DoseEvent[],
  days: number
): SamplePoint[] {
  const ts = new Set<number>();
  for (let t = 0; t <= days + 1e-9; t += 0.2) ts.add(+t.toFixed(2));
  for (const e of doses) {
    if (e.taken) {
      ts.add(e.t - 1e-4);
      ts.add(e.t);
    }
  }
  return [...ts].sort((a, b) => a - b).map((t) => ({ t, v: amountFn(t) }));
}

// ── 4.3 Steady-state band (the reference "your usual range") ─────────────────

/**
 * Simulate the PRESCRIBED regimen forward ≥ 5 half-lives at its cadence, then
 * take min / max / avg over the last steady interval. Generalizes the reference
 * (which walked a weekday pattern) to any half-life + cadence. The average is
 * the closed-form steady level, perDose / (k · intervalDays).
 */
export function steadyState(
  halfLifeDays: number,
  prescribed: PrescribedRegimen,
  windowDays?: number
): SteadyState {
  const k = Math.LN2 / halfLifeDays;
  const tau = prescribed.intervalDays;
  // Simulate well past steady (≥ ~12 half-lives) so the measured band converges
  // to the closed-form average perDose / (k · interval).
  const span = Math.max(windowDays ?? 0, 12 * halfLifeDays) + 2 * tau;

  const ideal: { t: number; amount: number }[] = [];
  for (let t = 0; t <= span + 1e-9; t += tau)
    ideal.push({ t, amount: prescribed.perDose });
  const amt = (t: number) =>
    ideal.reduce((s, e) => (e.t <= t ? s + e.amount * Math.exp(-k * (t - e.t)) : s), 0);

  const start = span - tau;
  let mn = Infinity;
  let mx = 0;
  let sum = 0;
  let n = 0;
  for (let t = start; t <= span + 1e-9; t += 0.1) {
    const v = amt(t);
    mn = Math.min(mn, v);
    mx = Math.max(mx, v);
    sum += v;
    n += 1;
  }
  return { trough: mn, peak: mx, avg: sum / n, k };
}

// ── 4.4 Percent-of-steady-state (ramp-up readout, descriptive only) ──────────

/** fractionToSteady(t) ≈ 1 − e^(−k·t): ~94% at 4 half-lives, ~97% at 5. */
export function fractionToSteady(halfLifeDays: number, t: number): number {
  return 1 - Math.exp(-(Math.LN2 / halfLifeDays) * t);
}

// ── 4.5 Time axis — pick unit + window automatically ─────────────────────────

/** Window = max(data span, ~5 half-lives) + a short projection (one interval). */
export function chooseWindowDays(
  doses: DoseEvent[],
  halfLifeDays: number,
  intervalDays = 7
): number {
  const dataSpan = doses.length ? Math.max(...doses.map((d) => d.t)) : 0;
  return Math.max(dataSpan, 5 * halfLifeDays) + intervalDays;
}

/** Weeks if half-life ≥ 3 days or the window exceeds 21 days; else days. */
export function axisChoice(windowDays: number, halfLifeDays: number): AxisChoice {
  const useWeeks = halfLifeDays >= 3 || windowDays > 21;
  return {
    days: windowDays,
    unitDays: useWeeks ? 7 : 1,
    unitLabel: useWeeks ? "weeks" : "days",
    labelEvery: useWeeks ? 4 : 7,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Project a repeating weekly regimen into discrete dose events. Mirrors the
 * reference's buildEvents — used for demos, the §6 worked examples, and tests.
 * The running app builds DoseEvent[] from real logged doses instead.
 */
export function eventsFromWeeklyPattern(opts: {
  perDose: number;
  /** day-of-week offsets within each week, 0 = first dosing day */
  weekdays: number[];
  weeks: number;
  /** day-offsets to mark as missed (omitted from the sum) */
  missed?: number[];
  /** dayOffset → amount, for catch-up / overdose scenarios */
  bigDoses?: Record<number, number>;
}): DoseEvent[] {
  const { perDose, weekdays, weeks, missed = [], bigDoses = {} } = opts;
  const ev: DoseEvent[] = [];
  for (let w = 0; w < weeks; w++) {
    for (const wd of weekdays) {
      const day = w * 7 + wd;
      const big = bigDoses[day];
      ev.push({
        t: day,
        amount: big ?? perDose,
        taken: !missed.includes(day),
        big: big != null,
      });
    }
  }
  return ev.sort((a, b) => a.t - b.t);
}
