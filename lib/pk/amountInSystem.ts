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
 * Sample the curve every 0.2 days. For a fast (instant-add) route we also
 * insert two points per taken dose (t−ε excludes the dose, t includes it) so
 * the jump draws crisp. For a slow-release route the dose rises smoothly over
 * ~Tmax, so the ε points are suppressed (`crispJumps: false`) and the sampler
 * leans on its 0.2-day grid to trace the rounded wave (Fix 1).
 */
export function sampleSeries(
  amountFn: (t: number) => number,
  doses: DoseEvent[],
  days: number,
  opts?: { crispJumps?: boolean }
): SamplePoint[] {
  const crispJumps = opts?.crispJumps ?? true;
  const ts = new Set<number>();
  for (let t = 0; t <= days + 1e-9; t += 0.2) ts.add(+t.toFixed(2));
  if (crispJumps) {
    for (const e of doses) {
      if (e.taken) {
        ts.add(e.t - 1e-4);
        ts.add(e.t);
      }
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

// ── 4.2 Route-aware dose kernel (Fix 1) ──────────────────────────────────────
//
// The DEFAULT amount-in-system view adds each dose instantly. That is only
// physically reasonable for FAST routes (oral immediate-release, IV, aqueous SC
// bolus). For SLOW-RELEASE routes (IM oil depot esters, depot SC, transdermal
// patches/implants) the dose is NOT on board instantly — it rises to a peak
// over ~Tmax (about a day or two), then declines. So the kernel is chosen from
// the route, not a global default: depot esters use a first-order (Bateman)
// absorption rise; patches/implants use a zero-order release plateau. Each
// kernel is normalised to a UNIT PEAK so a dose's peak contribution ≈ its
// amount in the drug's native unit (the reference's convention) — what changes
// per route is the SHAPE of the rise, not the scale. For depot esters
// absorption is rate-limiting (flip-flop kinetics): the rise spans ~Tmax and
// the slow terminal decline reflects that release.

/** How a single dose enters the system: a sharp add, a rounded rise, or a plateau. */
export type CurveShape = "instant" | "first_order" | "zero_order";

/** Absorption half-life used when no Tmax is supplied (≈ the reference's 2.7-day Tmax). */
const DEFAULT_ABSORPTION_HALF_LIFE_DAYS = 0.7;

/** Pick the curve shape from the model/route. Depot IM and transdermal are slow-release. */
export function curveShape(drug: DrugPK): CurveShape {
  if (drug.model === "zero_order") return "zero_order";
  if (drug.model === "serum_bateman") return "first_order";
  // Default amount_in_system: the route decides.
  switch (drug.route) {
    case "transdermal":
      return drug.releaseDurationDays ? "zero_order" : "first_order";
    case "intramuscular":
      return "first_order"; // oil depot ester → rounded wave, never a spike
    default:
      // oral / sublingual / IV / inhaled / SC aqueous bolus / suppository / topical
      return "instant";
  }
}

/** Instant bolus: full dose on board immediately, then first-order decay. */
function instantKernel(halfLifeDays: number): (dt: number) => number {
  const ke = Math.LN2 / halfLifeDays;
  return (dt) => (dt < 0 ? 0 : Math.exp(-ke * dt));
}

/**
 * First-order absorption (Bateman), normalised to a unit peak. Rises over ~Tmax
 * then declines on the terminal half-life. Ka is derived from Tmax when given,
 * else from a short default absorption half-life.
 */
function firstOrderKernel(
  halfLifeDays: number,
  tmaxDays?: number
): (dt: number) => number {
  const ke = Math.LN2 / halfLifeDays;
  let ka: number;
  if (tmaxDays && tmaxDays > 0) {
    const ratio = Math.min(tmaxDays / halfLifeDays, 0.99);
    ka = Math.LN2 / (tmaxDays * (1 - ratio));
  } else {
    ka = Math.LN2 / DEFAULT_ABSORPTION_HALF_LIFE_DAYS;
  }
  if (ka <= ke) ka = ke * 1.5; // guarantee absorption-then-elimination
  const tp = Math.log(ka / ke) / (ka - ke);
  const peak = Math.exp(-ke * tp) - Math.exp(-ka * tp);
  return (dt) =>
    dt < 0 ? 0 : (Math.exp(-ke * dt) - Math.exp(-ka * dt)) / peak;
}

/**
 * Zero-order release over `releaseDays`, then first-order decay — normalised so
 * the level at end-of-release (the peak) is 1. Roughly flat while applied, then
 * decays after removal: a transdermal patch / implant.
 */
function zeroOrderKernel(
  halfLifeDays: number,
  releaseDays: number
): (dt: number) => number {
  const ke = Math.LN2 / halfLifeDays;
  const rate = 1 / releaseDays; // unit dose released over the window
  const apeak = (rate / ke) * (1 - Math.exp(-ke * releaseDays));
  return (dt) => {
    if (dt < 0) return 0;
    if (dt <= releaseDays) return ((rate / ke) * (1 - Math.exp(-ke * dt))) / apeak;
    return Math.exp(-ke * (dt - releaseDays));
  };
}

/** The unit-dose contribution at `dt` days after a dose, for this drug's route. */
export function doseKernel(drug: DrugPK): (dt: number) => number {
  switch (curveShape(drug)) {
    case "zero_order":
      return zeroOrderKernel(
        drug.halfLifeDays,
        drug.releaseDurationDays ?? drug.tmaxDays ?? 1
      );
    case "first_order":
      return firstOrderKernel(drug.halfLifeDays, drug.tmaxDays);
    default:
      return instantKernel(drug.halfLifeDays);
  }
}

/**
 * Route-aware amount(t): Σ doseᵢ.amount · kern(t − doseᵢ.t) over taken doses
 * with t ≤ now. Same superposition as {@link makeAmountFn}, but the per-dose
 * kernel follows the route so a depot dose rises to a peak instead of jumping.
 */
export function makeAmountFnForDrug(
  drug: DrugPK,
  doses: DoseEvent[]
): (t: number) => number {
  const kern = doseKernel(drug);
  return (t) =>
    doses.reduce((s, e) => (e.taken && e.t <= t ? s + e.amount * kern(t - e.t) : s), 0);
}

// ── 4.2b Accumulation regime (Fix 2) ─────────────────────────────────────────
//
// Whether the "builds to a steady plateau" story is true depends on the dosing
// interval relative to the half-life. The accumulation ratio
//   R = 1 / (1 − e^(−k·τ))            τ = interval in days, k = ln2 / halfLife
// is how much the level settles to, relative to a single dose's peak. R ≳ 1.3
// means doses stack into a steady range; R near 1 means each dose largely
// clears before the next — a roller-coaster, no plateau.

export type Regime = "accumulates" | "intermediate" | "clears";

/** R = 1 / (1 − e^(−k·τ)). */
export function accumulationRatio(halfLifeDays: number, intervalDays: number): number {
  const k = Math.LN2 / halfLifeDays;
  return 1 / (1 - Math.exp(-k * intervalDays));
}

/** Map R to a narrative regime: clears (<1.3), intermediate (<2), accumulates (≥2). */
export function regimeOf(R: number): Regime {
  if (R < 1.3) return "clears";
  if (R < 2) return "intermediate";
  return "accumulates";
}

/**
 * Derive a reference band straight from the drawn curve over [fromT, toT] — so
 * the band always lines up with the curve regardless of the route's kernel
 * (the closed-form {@link steadyState} only matches the instant-bolus shape).
 */
export function bandFromSeries(
  series: SamplePoint[],
  fromT: number,
  toT: number
): { trough: number; peak: number; avg: number } | null {
  let mn = Infinity;
  let mx = 0;
  let sum = 0;
  let n = 0;
  for (const p of series) {
    if (p.t >= fromT && p.t <= toT) {
      mn = Math.min(mn, p.v);
      mx = Math.max(mx, p.v);
      sum += p.v;
      n += 1;
    }
  }
  return n ? { trough: mn, peak: mx, avg: sum / n } : null;
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
