// Unit conversion utilities (PRD §5.11). Handles concentration conversions
// and syringe volume calculations. Display-only — stored values stay in
// native units.

// ── Concentration conversions ──────────────────────────────────────────────

/** Convert mg/mL to percentage (w/v). 1% = 10 mg/mL. */
export function mgPerMlToPercent(mgPerMl: number): number {
  return mgPerMl / 10;
}

/** Convert percentage (w/v) to mg/mL. */
export function percentToMgPerMl(percent: number): number {
  return percent * 10;
}

/** Convert mg/mL to mg per pump (given pump volume in mL). */
export function mgPerMlToMgPerPump(
  mgPerMl: number,
  pumpVolumeMl: number
): number {
  return mgPerMl * pumpVolumeMl;
}

/** Convert mg per actuation to mg/mL (given actuation volume in mL). */
export function mgPerActuationToMgPerMl(
  mgPerActuation: number,
  actuationVolumeMl: number
): number {
  if (actuationVolumeMl <= 0) return 0;
  return mgPerActuation / actuationVolumeMl;
}

// ── Syringe volume calculation ─────────────────────────────────────────────

/**
 * Calculate the volume (mL) needed for a given dose, given the vial
 * concentration. This is the primary calculation for injectable medications.
 *
 * @param doseAmount Desired dose in the dose unit (e.g. 100 mg).
 * @param concentrationAmount Concentration amount (e.g. 200 mg).
 * @param concentrationPerVolume Volume for that concentration (e.g. 1 mL).
 * @returns Volume in mL needed to deliver the dose.
 */
export function doseToVolumeMl(
  doseAmount: number,
  concentrationAmount: number,
  concentrationPerVolume: number
): number {
  if (concentrationAmount <= 0 || concentrationPerVolume <= 0) return 0;
  const mgPerMl = concentrationAmount / concentrationPerVolume;
  return doseAmount / mgPerMl;
}

/**
 * Format a volume for syringe display, rounding to the nearest practical
 * syringe marking (0.01 mL for insulin syringes, 0.1 mL for standard).
 */
export function formatVolumeMl(
  volumeMl: number,
  syringeCapacityMl?: number
): string {
  // Insulin syringes (≤1mL) use 0.01 mL markings; larger use 0.1 mL.
  const precision =
    syringeCapacityMl !== undefined && syringeCapacityMl <= 1 ? 2 : 1;
  return `${volumeMl.toFixed(precision)} mL`;
}

// ── Cross-jurisdictional dose translation ──────────────────────────────────

/** Weight conversion factors to mg. */
const TO_MG: Record<string, number> = {
  mg: 1,
  mcg: 0.001,
  g: 1000,
  grain: 64.8,
  IU: 1, // IU is unit-specific, not weight — passthrough
  unit: 1,
};

/**
 * Convert a dose from one unit to another (where both are weight-based).
 * Returns null if conversion is not supported.
 */
export function convertDose(
  amount: number,
  fromUnit: string,
  toUnit: string
): number | null {
  const fromFactor = TO_MG[fromUnit];
  const toFactor = TO_MG[toUnit];
  if (fromFactor === undefined || toFactor === undefined) return null;
  if (toFactor === 0) return null;
  return (amount * fromFactor) / toFactor;
}
