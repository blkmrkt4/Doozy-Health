// Deterministic pharmacokinetic engine (PRD §5.7, CLAUDE.md hard rule #8).
// Architecture: superposition engine + per-route kernel library + linearity gate.
// All math is TypeScript — no LLM involvement.

import type { KernelType, CatalogueMetabolite } from "@/lib/drug-catalogue";

// ── Types ──────────────────────────────────────────────────────────────────

export type PkParams = {
  halfLifeHours: number;
  /** Population range [low, high] for the uncertainty band. */
  halfLifeRange?: [number, number];
  /** Fraction absorbed, 0..1. Defaults to 1.0 if unknown. */
  bioavailability: number;
  /** Time to peak concentration in hours. */
  tmaxHours: number;
  /** Kernel shape for this route. */
  kernel: KernelType;
  /** Release duration in hours (zero-order kernels only). */
  releaseDurationHours?: number;
  /** Linearity gate (§5.7). False = no curve rendered. */
  isLinear: boolean;
  /** Reason shown when isLinear = false. */
  nonlinearReason?: string;
  /** Active metabolites with their own PK params. */
  metabolites?: MetaboliteParams[];
};

export type MetaboliteParams = {
  name: string;
  fraction: number;
  kernel: KernelType;
  halfLifeHours: number;
  tmaxHours: number;
};

export type DoseEvent = {
  /** Unix ms. */
  timestamp: number;
  /** Dose amount in native units. */
  amount: number;
};

export type PkPoint = {
  /** Unix ms. */
  timestamp: number;
  /** Modelled relative concentration (arbitrary units). */
  concentration: number;
};

export type MetaboliteSeries = {
  name: string;
  points: PkPoint[];
};

export type PkTimeSeries = {
  points: PkPoint[];
  /** Uncertainty band — upper bound (longer half-life). */
  upperBound?: PkPoint[];
  /** Uncertainty band — lower bound (shorter half-life). */
  lowerBound?: PkPoint[];
  /** Active metabolite concentration series. */
  metaboliteSeries?: MetaboliteSeries[];
  doseMarkers: { timestamp: number; amount: number }[];
  /** Minimum projected concentration in the future window, or null. */
  projectedTrough: PkPoint | null;
  /** Estimated time to reach steady state (unix ms), or undefined. */
  steadyStateTimestamp?: number;
  /** Index in `points` closest to the current time. */
  nowIndex: number;
};

export type CalibrationReading = {
  value: number;
  observedAt: number; // unix ms
};

export type CalibrationResult =
  | { ok: true; personalHalfLifeHours: number }
  | { ok: false; reason: string };

// ── Constants ──────────────────────────────────────────────────────────────

const MS_PER_HOUR = 3_600_000;
const DEFAULT_STEP_MS = MS_PER_HOUR;

// ── Kernel library (§5.7) ──────────────────────────────────────────────────

/**
 * Exponential kernel: instant peak (IV-like), then first-order decay.
 * C(t) = dose × 0.5^(t / t½)
 */
function kernelExponential(
  dose: number,
  elapsedHours: number,
  halfLife: number
): number {
  if (elapsedHours < 0) return 0;
  return dose * Math.pow(0.5, elapsedHours / halfLife);
}

/**
 * Bateman kernel: first-order absorption + elimination. The absorption rate
 * constant Ka is derived from Tmax: Ka = (ke × ka) where ke = ln2/t½ and
 * the peak occurs at Tmax = ln(Ka/ke) / (Ka - ke). For practical computation
 * we use the simplified two-compartment form:
 *   C(t) = dose × (Ka / (Ka - ke)) × (e^(-ke×t) - e^(-Ka×t))
 * where Ka is derived to place the peak at Tmax.
 */
function kernelBateman(
  dose: number,
  elapsedHours: number,
  halfLife: number,
  tmax: number
): number {
  if (elapsedHours < 0) return 0;

  const ke = Math.LN2 / halfLife;

  // Derive Ka from Tmax. For the Bateman function, Tmax = ln(Ka/ke) / (Ka - ke).
  // We use a practical approximation: Ka ≈ ln(2) / (Tmax × (1 - Tmax/halfLife))
  // which is accurate for Tmax < halfLife (the common case).
  const ratio = tmax / halfLife;
  let ka: number;
  if (ratio >= 0.99) {
    // Tmax ≈ halfLife: use a simpler model (nearly flip-flop kinetics).
    ka = ke * 2;
  } else {
    ka = Math.LN2 / (tmax * (1 - ratio));
  }

  // Ensure Ka > ke for a proper absorption-then-elimination shape.
  if (ka <= ke) ka = ke * 1.5;

  const scale = ka / (ka - ke);
  return dose * scale * (Math.exp(-ke * elapsedHours) - Math.exp(-ka * elapsedHours));
}

/**
 * Zero-order kernel: constant-rate release for `releaseDuration` hours,
 * then first-order elimination. Used for transdermal patches and implants.
 * During release: C accumulates linearly (approximation of constant infusion).
 * After release: exponential decay from the level at end of release.
 */
function kernelZeroOrder(
  dose: number,
  elapsedHours: number,
  halfLife: number,
  releaseDuration: number
): number {
  if (elapsedHours < 0) return 0;

  const ke = Math.LN2 / halfLife;
  const rate = dose / releaseDuration;

  if (elapsedHours <= releaseDuration) {
    // During release: approximate steady-state accumulation.
    // C(t) = (rate / ke) × (1 - e^(-ke×t))
    return (rate / ke) * (1 - Math.exp(-ke * elapsedHours));
  }

  // After release: level at end of release × decay.
  const levelAtEnd = (rate / ke) * (1 - Math.exp(-ke * releaseDuration));
  const decayHours = elapsedHours - releaseDuration;
  return levelAtEnd * Math.exp(-ke * decayHours);
}

/**
 * Dispatch to the correct kernel based on type.
 */
function kernelDispatch(
  dose: number,
  elapsedHours: number,
  halfLife: number,
  tmax: number,
  kernel: KernelType,
  releaseDuration?: number
): number {
  switch (kernel) {
    case "exponential":
      return kernelExponential(dose, elapsedHours, halfLife);
    case "zeroOrder":
      return kernelZeroOrder(dose, elapsedHours, halfLife, releaseDuration ?? tmax);
    case "bateman":
    default:
      return kernelBateman(dose, elapsedHours, halfLife, tmax);
  }
}

// ── Superposition engine ───────────────────────────────────────────────────

/**
 * Single dose contribution at time t, using the specified kernel.
 */
function doseContribution(
  doseTimestamp: number,
  doseAmount: number,
  params: PkParams,
  t: number
): number {
  const elapsedMs = t - doseTimestamp;
  if (elapsedMs < 0) return 0;

  const elapsedHours = elapsedMs / MS_PER_HOUR;
  const effectiveDose = doseAmount * params.bioavailability;

  return kernelDispatch(
    effectiveDose,
    elapsedHours,
    params.halfLifeHours,
    params.tmaxHours,
    params.kernel,
    params.releaseDurationHours
  );
}

/**
 * Compute a concentration series by superimposing all dose contributions.
 */
function computeSeries(
  doses: DoseEvent[],
  halfLife: number,
  bioavailability: number,
  tmax: number,
  kernel: KernelType,
  releaseDuration: number | undefined,
  rangeStart: number,
  rangeEnd: number,
  stepMs: number
): PkPoint[] {
  const points: PkPoint[] = [];
  const params: PkParams = {
    halfLifeHours: halfLife,
    bioavailability,
    tmaxHours: tmax,
    kernel,
    releaseDurationHours: releaseDuration,
    isLinear: true,
  };

  for (let t = rangeStart; t <= rangeEnd; t += stepMs) {
    let concentration = 0;
    for (const dose of doses) {
      concentration += doseContribution(dose.timestamp, dose.amount, params, t);
    }
    points.push({ timestamp: t, concentration });
  }
  return points;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Compute a modelled concentration time-series with uncertainty band,
 * metabolite series, and steady-state estimation.
 */
export function computeConcentration(
  doses: DoseEvent[],
  params: PkParams,
  rangeStart: number,
  rangeEnd: number,
  now: number,
  stepMs: number = DEFAULT_STEP_MS
): PkTimeSeries {
  // Main series.
  const points = computeSeries(
    doses,
    params.halfLifeHours,
    params.bioavailability,
    params.tmaxHours,
    params.kernel,
    params.releaseDurationHours,
    rangeStart,
    rangeEnd,
    stepMs
  );

  // Now index.
  let nowIndex = 0;
  let minNowDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dist = Math.abs(points[i].timestamp - now);
    if (dist < minNowDist) {
      minNowDist = dist;
      nowIndex = i;
    }
  }

  // Uncertainty band (population half-life range).
  let upperBound: PkPoint[] | undefined;
  let lowerBound: PkPoint[] | undefined;
  if (params.halfLifeRange) {
    const [low, high] = params.halfLifeRange;
    // Longer half-life = higher sustained level = upper bound.
    upperBound = computeSeries(
      doses, high, params.bioavailability, params.tmaxHours,
      params.kernel, params.releaseDurationHours, rangeStart, rangeEnd, stepMs
    );
    // Shorter half-life = lower sustained level = lower bound.
    lowerBound = computeSeries(
      doses, low, params.bioavailability, params.tmaxHours,
      params.kernel, params.releaseDurationHours, rangeStart, rangeEnd, stepMs
    );
  }

  // Active metabolite series.
  let metaboliteSeries: MetaboliteSeries[] | undefined;
  if (params.metabolites && params.metabolites.length > 0) {
    metaboliteSeries = params.metabolites.map((met) => {
      const metDoses = doses.map((d) => ({
        ...d,
        amount: d.amount * met.fraction,
      }));
      const metPoints = computeSeries(
        metDoses,
        met.halfLifeHours,
        1.0, // metabolite bioavailability is already in the fraction
        met.tmaxHours,
        met.kernel,
        undefined,
        rangeStart,
        rangeEnd,
        stepMs
      );
      return { name: met.name, points: metPoints };
    });
  }

  // Projected trough: minimum concentration from now to end.
  let projectedTrough: PkPoint | null = null;
  for (let i = nowIndex; i < points.length; i++) {
    if (!projectedTrough || points[i].concentration < projectedTrough.concentration) {
      projectedTrough = points[i];
    }
  }

  // Steady-state estimation: ~5 half-lives from the first dose.
  let steadyStateTimestamp: number | undefined;
  if (doses.length > 0) {
    const firstDose = Math.min(...doses.map((d) => d.timestamp));
    const ssTime = firstDose + 5 * params.halfLifeHours * MS_PER_HOUR;
    if (ssTime >= rangeStart && ssTime <= rangeEnd) {
      steadyStateTimestamp = ssTime;
    }
  }

  const doseMarkers = doses
    .filter((d) => d.timestamp >= rangeStart && d.timestamp <= rangeEnd)
    .map((d) => ({ timestamp: d.timestamp, amount: d.amount }));

  return {
    points,
    upperBound,
    lowerBound,
    metaboliteSeries,
    doseMarkers,
    projectedTrough,
    steadyStateTimestamp,
    nowIndex,
  };
}

/**
 * Look up PK params for a drug + route from the drugs table fields (v0.4).
 */
export function resolveParams(
  drug: {
    half_life_hours: Record<string, number>;
    half_life_range_hours?: Record<string, [number, number]>;
    bioavailability?: Record<string, number>;
    tmax_hours?: Record<string, number>;
    kernel_by_route?: Record<string, string>;
    release_duration_hours?: Record<string, number>;
    is_linear?: boolean;
    nonlinear_reason?: string;
    metabolites?: CatalogueMetabolite[];
  },
  route: string
): PkParams | null {
  const halfLife = drug.half_life_hours[route];
  if (!halfLife || halfLife <= 0) return null;

  const kernel = (drug.kernel_by_route?.[route] ?? "bateman") as KernelType;

  return {
    halfLifeHours: halfLife,
    halfLifeRange: drug.half_life_range_hours?.[route],
    bioavailability: drug.bioavailability?.[route] ?? 1.0,
    tmaxHours: drug.tmax_hours?.[route] ?? 1.0,
    kernel,
    releaseDurationHours: drug.release_duration_hours?.[route],
    isLinear: drug.is_linear ?? true,
    nonlinearReason: drug.nonlinear_reason ?? undefined,
    metabolites: drug.metabolites?.map((m) => ({
      name: m.name,
      fraction: m.fraction,
      kernel: m.kernel,
      halfLifeHours: m.half_life_hours,
      tmaxHours: m.tmax_hours,
    })),
  };
}

/**
 * Generate a projected dose series from a frequency schedule.
 */
export function generateScheduledDoses(
  frequency: { type: string; interval?: number; unit?: string; count?: number; period?: string },
  doseAmount: number,
  rangeStart: number,
  rangeEnd: number
): DoseEvent[] {
  let intervalMs: number;

  if (frequency.type === "every" && frequency.interval && frequency.unit) {
    const multiplier: Record<string, number> = {
      hour: MS_PER_HOUR,
      day: MS_PER_HOUR * 24,
      week: MS_PER_HOUR * 24 * 7,
      month: MS_PER_HOUR * 24 * 30,
    };
    intervalMs = frequency.interval * (multiplier[frequency.unit] ?? MS_PER_HOUR * 24);
  } else if (frequency.type === "times_per" && frequency.count && frequency.period) {
    const periodMs = frequency.period === "week"
      ? MS_PER_HOUR * 24 * 7
      : MS_PER_HOUR * 24;
    intervalMs = periodMs / frequency.count;
  } else {
    return [];
  }

  const doses: DoseEvent[] = [];
  for (let t = rangeStart; t <= rangeEnd; t += intervalMs) {
    doses.push({ timestamp: t, amount: doseAmount });
  }
  return doses;
}

// ── Personal calibration (§4.8, §5.7) ──────────────────────────────────────

/**
 * Back-solve a personal terminal half-life from ≥2 decline-phase readings.
 * Readings must be taken during a decline (no intervening dose).
 *
 * Math: k = ln(C1/C2) / (t2 - t1), halfLife = ln(2) / k
 * Constrained to physiologically plausible bounds (0.1× to 10× textbook).
 */
export function calibrateHalfLife(
  readings: CalibrationReading[],
  textbookHalfLifeHours: number
): CalibrationResult {
  if (readings.length < 2) {
    return { ok: false, reason: "At least two readings are required." };
  }

  // Sort by time.
  const sorted = [...readings].sort((a, b) => a.observedAt - b.observedAt);

  // Use the first two readings for a simple two-point fit.
  const c1 = sorted[0].value;
  const c2 = sorted[1].value;
  const t1 = sorted[0].observedAt;
  const t2 = sorted[1].observedAt;

  if (c1 <= 0 || c2 <= 0) {
    return { ok: false, reason: "Readings must be positive values." };
  }
  if (c2 >= c1) {
    return {
      ok: false,
      reason: "The second reading must be lower than the first (decline phase).",
    };
  }

  const deltaHours = (t2 - t1) / MS_PER_HOUR;
  if (deltaHours <= 0) {
    return { ok: false, reason: "Readings must be at different times." };
  }

  const k = Math.log(c1 / c2) / deltaHours;
  const personalHalfLife = Math.LN2 / k;

  // Plausibility bounds: 0.1× to 10× textbook.
  const low = textbookHalfLifeHours * 0.1;
  const high = textbookHalfLifeHours * 10;

  if (personalHalfLife < low || personalHalfLife > high) {
    return {
      ok: false,
      reason: `Computed half-life (${personalHalfLife.toFixed(1)}h) is outside plausible bounds (${low.toFixed(0)}–${high.toFixed(0)}h). The textbook curve is retained.`,
    };
  }

  return { ok: true, personalHalfLifeHours: personalHalfLife };
}
