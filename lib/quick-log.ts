import { doseToVolumeMl } from "@/lib/units";
import type { MedLogMeta } from "@/lib/adherence";

// Single source of truth for the quickLogDose FormData contract, shared by the
// dashboard check-dots (med-dose-row) and the simple-mode Today cards so the
// two logging paths can never drift. Amounts are always submitted in the
// regimen unit; for syringe-drawn injectables the user-facing figure is mL and
// the conversion happens here.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local "noon on that day" in datetime-local format, for back-dated logs. */
export function noonInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T12:00`;
}

/** True when the dose is drawn with a syringe, so the display figure is mL. */
export function canDrawWithSyringe(meta: MedLogMeta): boolean {
  return (
    meta.isInjectable &&
    meta.concentrationAmount != null &&
    meta.concentrationAmount > 0
  );
}

/** Regimen-unit amount per mL of solution (0 when not syringe-drawn). */
export function amountPerMl(meta: MedLogMeta): number {
  if (!canDrawWithSyringe(meta)) return 0;
  return meta.concentrationAmount! / (meta.concentrationPerVolume || 1);
}

/** Decimal places for a mL figure, from the syringe capacity. */
export function mlPrecision(meta: MedLogMeta): number {
  return (meta.syringeCapacityMl ?? 1) <= 1 ? 2 : 1;
}

/**
 * The default editable dose figure and its display unit: mL for syringe-drawn
 * injectables (converted back to the regimen unit on log), otherwise the
 * chosen-regimen amount in its own unit.
 */
export function defaultDoseText(meta: MedLogMeta, doseBasis: "volume" | "regimen" = "volume"): {
  doseText: string;
  unitLabel: string;
} {
  if (doseBasis === "volume" && canDrawWithSyringe(meta)) {
    return {
      doseText: doseToVolumeMl(
        meta.defaultAmount,
        meta.concentrationAmount!,
        meta.concentrationPerVolume || 1
      ).toFixed(mlPrecision(meta)),
      unitLabel: "ml",
    };
  }
  return { doseText: String(meta.defaultAmount), unitLabel: meta.defaultUnit };
}

/**
 * Build the FormData quickLogDose expects, or null when the figure is invalid.
 * `doseText` is the user-facing figure (mL when syringe-drawn).
 */
export function buildQuickLogFormData(opts: {
  meta: MedLogMeta;
  doseText: string;
  dayMs: number;
  isToday: boolean;
  doseBasis?: "volume" | "regimen";
}): FormData | null {
  const { meta, doseText, dayMs, isToday } = opts;
  const n = Number(doseText);
  if (!Number.isFinite(n) || n <= 0) return null;
  const syringe = opts.doseBasis !== "regimen" && canDrawWithSyringe(meta);
  const amount = syringe ? n * amountPerMl(meta) : n;
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const fd = new FormData();
  fd.set("medication_id", meta.medId);
  fd.set("amount", String(amount));
  fd.set("unit", meta.defaultUnit);
  fd.set("route_taken", meta.defaultRoute);
  if (syringe) fd.set("note", `${doseText} mL drawn`);
  if (!isToday) fd.set("logged_at", noonInput(dayMs));
  return fd;
}
