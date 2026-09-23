import { convertDose } from "@/lib/units";
import type { Frequency } from "@/lib/types";

/** Relate medication amount to liquid volume without rounding the stored dose
 * or treating incompatible units as equivalent (PRD §4.3/§5.11). */
export function injectionDoseDetails(opts: {
  doseAmount: number;
  doseUnit: string;
  concentrationAmount: number;
  concentrationUnit: string;
  concentrationPerVolume: number;
  frequency?: Frequency | null;
}) {
  if (![opts.doseAmount, opts.concentrationAmount, opts.concentrationPerVolume].every((n) => Number.isFinite(n) && n > 0)) return null;
  const perMl = opts.concentrationAmount / opts.concentrationPerVolume;
  let factor: number;
  if (opts.doseUnit === "mL") factor = perMl;
  else if (opts.doseUnit === opts.concentrationUnit) factor = 1;
  else {
    const massUnits = ["mg", "mcg", "g", "grain"];
    if (!massUnits.includes(opts.doseUnit) || !massUnits.includes(opts.concentrationUnit)) return null;
    factor = convertDose(1, opts.doseUnit, opts.concentrationUnit)!;
  }
  const medicationAmount = opts.doseAmount * factor;
  const volumeMl = medicationAmount / perMl;
  if (![perMl, medicationAmount, volumeMl].every((n) => Number.isFinite(n) && n > 0)) return null;
  const f = opts.frequency;
  const weeklyDoses = f?.type === "weekly" ? f.days.length : f?.type === "times_per" && f.period === "week" ? f.count : null;
  const weeklyAmount = weeklyDoses == null ? null : f?.type === "weekly" && f.weekly_total != null
    ? f.weekly_total * factor : medicationAmount * weeklyDoses;
  return { medicationAmount, medicationUnit: opts.concentrationUnit, volumeMl, perMl, weeklyDoses, weeklyAmount };
}

export function explainedQuantity(value: number, decimals: number): string {
  const rounded = Number(value.toFixed(decimals));
  const formatted = value.toLocaleString("en-US", rounded === 0 ? { maximumSignificantDigits: 4 } : { maximumFractionDigits: decimals });
  return `${Math.abs(value - rounded) > 1e-10 ? "approximately " : ""}${formatted}`;
}
