// Deterministic pharmacokinetic engine (PRD §5.7, CLAUDE.md hard rule #8).
// Single-compartment first-order elimination with dose superposition.
// All math is TypeScript — no LLM involvement.

// ── Types ──────────────────────────────────────────────────────────────────

export type PkParams = {
  halfLifeHours: number;
  /** Fraction absorbed, 0..1. Defaults to 1.0 if unknown. */
  bioavailability: number;
  /** Time to peak concentration in hours. */
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

export type PkTimeSeries = {
  points: PkPoint[];
  doseMarkers: { timestamp: number; amount: number }[];
  /** Minimum projected concentration in the future window, or null. */
  projectedTrough: PkPoint | null;
  /** Index in `points` closest to the current time. */
  nowIndex: number;
};

// ── Constants ──────────────────────────────────────────────────────────────

const MS_PER_HOUR = 3_600_000;
const DEFAULT_STEP_MS = MS_PER_HOUR; // 1-hour resolution

// ── Core math ──────────────────────────────────────────────────────────────

/**
 * Concentration contribution of a single dose at time `t` (ms since epoch).
 *
 * Model: linear absorption to Cmax over Tmax, then first-order elimination.
 *   - Absorption phase (0 ≤ elapsed < Tmax): C = effectiveDose × (elapsed / Tmax)
 *   - Elimination phase (elapsed ≥ Tmax): C = effectiveDose × 0.5^((elapsed - Tmax) / t½)
 *
 * `effectiveDose` = dose × bioavailability (scales the peak height).
 * Units are relative — this is illustrative, not absolute concentration.
 */
function doseContribution(
  doseTimestamp: number,
  doseAmount: number,
  params: PkParams,
  t: number
): number {
  const elapsedMs = t - doseTimestamp;
  if (elapsedMs < 0) return 0; // dose hasn't happened yet

  const elapsedHours = elapsedMs / MS_PER_HOUR;
  const effectiveDose = doseAmount * params.bioavailability;

  if (elapsedHours < params.tmaxHours) {
    // Absorption phase: linear ramp to peak.
    return effectiveDose * (elapsedHours / params.tmaxHours);
  }

  // Elimination phase: exponential decay from peak.
  const decayHours = elapsedHours - params.tmaxHours;
  return effectiveDose * Math.pow(0.5, decayHours / params.halfLifeHours);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Compute a modelled concentration time-series by superimposing all dose
 * contributions at regular time steps.
 *
 * @param doses    Array of dose events (timestamp + amount).
 * @param params   PK parameters for the drug + route.
 * @param rangeStart  Start of the time window (unix ms).
 * @param rangeEnd    End of the time window (unix ms).
 * @param now         Current time (unix ms) — used for the "you are here" marker.
 * @param stepMs      Time step in ms (default: 1 hour).
 */
export function computeConcentration(
  doses: DoseEvent[],
  params: PkParams,
  rangeStart: number,
  rangeEnd: number,
  now: number,
  stepMs: number = DEFAULT_STEP_MS
): PkTimeSeries {
  const points: PkPoint[] = [];
  let nowIndex = 0;
  let minNowDist = Infinity;

  for (let t = rangeStart; t <= rangeEnd; t += stepMs) {
    let concentration = 0;
    for (const dose of doses) {
      concentration += doseContribution(dose.timestamp, dose.amount, params, t);
    }
    points.push({ timestamp: t, concentration });

    const dist = Math.abs(t - now);
    if (dist < minNowDist) {
      minNowDist = dist;
      nowIndex = points.length - 1;
    }
  }

  // Projected trough: minimum concentration from now to rangeEnd.
  let projectedTrough: PkPoint | null = null;
  for (let i = nowIndex; i < points.length; i++) {
    if (!projectedTrough || points[i].concentration < projectedTrough.concentration) {
      projectedTrough = points[i];
    }
  }

  const doseMarkers = doses
    .filter((d) => d.timestamp >= rangeStart && d.timestamp <= rangeEnd)
    .map((d) => ({ timestamp: d.timestamp, amount: d.amount }));

  return { points, doseMarkers, projectedTrough, nowIndex };
}

/**
 * Look up PK params for a drug + route from the drugs table JSON fields.
 * Returns null if the drug has no PK data for the given route.
 */
export function resolveParams(
  drug: {
    half_life_hours: Record<string, number>;
    bioavailability?: Record<string, number>;
    tmax_hours?: Record<string, number>;
  },
  route: string
): PkParams | null {
  const halfLife = drug.half_life_hours[route];
  if (!halfLife || halfLife <= 0) return null;

  return {
    halfLifeHours: halfLife,
    bioavailability: drug.bioavailability?.[route] ?? 1.0,
    tmaxHours: drug.tmax_hours?.[route] ?? 1.0,
  };
}

/**
 * Generate a projected dose series from a frequency schedule, used to
 * model the prescribed or chosen regimen overlay. Produces dose events
 * at regular intervals within the given time window.
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
    // as_needed or unknown — no scheduled doses.
    return [];
  }

  const doses: DoseEvent[] = [];
  for (let t = rangeStart; t <= rangeEnd; t += intervalMs) {
    doses.push({ timestamp: t, amount: doseAmount });
  }
  return doses;
}
