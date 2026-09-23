import type { SyringeSpec } from "@/lib/types";

export type LengthUnit = "in" | "mm";
const fractions: Record<string, string> = {
  "¼": "1/4", "½": "1/2", "¾": "3/4", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
  "⅓": "1/3", "⅔": "2/3", "⅙": "1/6", "⅚": "5/6",
};

function positiveNumber(raw: string): number | null {
  const text = raw.trim().replace(/[¼½¾⅛⅜⅝⅞⅓⅔⅙⅚]/g, (f) => ` ${fractions[f]}`).trim().replace(/⁄/g, "/");
  const fraction = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(text);
  let value: number;
  if (fraction) {
    const denominator = Number(fraction[3]);
    if (!denominator) return null;
    value = Number(fraction[1] ?? 0) + Number(fraction[2]) / denominator;
  } else if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    value = Number(text);
  } else return null;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function lengthEntry(raw: string): { amount: string; unit?: LengthUnit } {
  const match = /\s*(mm|millimeters?|millimetres?|inches|inch|in|["″])\s*$/i.exec(raw);
  if (!match) return { amount: raw.trim() };
  return { amount: raw.slice(0, match.index).trim(), unit: /^m/i.test(match[1]) ? "mm" : "in" };
}

/** Exact unit conversion; keep the existing inches-based storage (PRD §5.11). */
export function parseNeedleLength(raw: string, unit: string = "in"): number | null {
  if (unit !== "in" && unit !== "mm") return null;
  const entry = lengthEntry(raw);
  const value = positiveNumber(entry.amount);
  return value == null ? null : (entry.unit ?? unit) === "mm" ? value / 25.4 : value;
}

export function parseSyringeCapacity(raw: string): number | null {
  return positiveNumber(raw.replace(/\s*(ml|cc)\s*$/i, ""));
}

export function parseNeedleGauge(raw: string): number | null {
  const value = positiveNumber(raw.replace(/\s*g\s*$/i, ""));
  return value != null && Number.isInteger(value) ? value : null;
}

/** Only explicit volume spacing is usable as a scale; a printed scale number
 * or insulin-unit label alone does not establish the smallest graduation. */
export function syringeMarkSpacing(raw: string | undefined, capacity: number): number | null {
  const text = (raw ?? "").trim().replace(/\s*(?:increments?|between (?:lines|marks))$/i, "");
  const spacing = parseSyringeCapacity(text);
  return spacing != null && capacity > 0 && spacing <= capacity ? spacing : null;
}

export function formatNeedleLength(inches: number): string {
  const eighths = Math.round(inches * 8);
  let imperial: string;
  if (Math.abs(eighths / 8 - inches) < 1e-10) {
    const whole = Math.floor(eighths / 8);
    const fraction = ["", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8"][eighths % 8];
    imperial = [whole || !fraction ? String(whole) : "", fraction].filter(Boolean).join(" ");
  } else imperial = inches.toLocaleString("en-US", { maximumSignificantDigits: 6 });
  const mm = inches * 25.4;
  const metric = mm.toLocaleString("en-US", { maximumSignificantDigits: 6 });
  const approximateInches = Math.abs(Number(inches.toPrecision(6)) - inches) > 1e-10;
  const approximateMm = Math.abs(Number(mm.toPrecision(6)) - mm) > 1e-10;
  return `${approximateInches ? "approximately " : ""}${imperial} in (${approximateMm ? "approximately " : ""}${metric} mm)`;
}

export function readSyringeMeasurements(formData: FormData, prefix = "", requireCapacityForDetails = false) {
  const field = (name: string) => String(formData.get(`${prefix}${name}`) ?? "").trim();
  const capacity = field("capacity_ml");
  const gauge = field("needle_gauge");
  // Older forms and extraction payloads already use decimal inches.
  const hasLengthEntry = formData.has(`${prefix}needle_length`);
  const length = hasLengthEntry ? field("needle_length") : field("needle_length_in");
  const unit = hasLengthEntry ? field("needle_length_unit") || "in" : "in";
  const spec: Partial<SyringeSpec> = {};
  const errors: { capacity?: string; gauge?: string; length?: string; markings?: string } = {};
  if (capacity) {
    const value = parseSyringeCapacity(capacity);
    if (value == null) errors.capacity = "Enter a positive syringe capacity, such as 1 mL.";
    else spec.capacity_mL = value;
  }
  if (gauge) {
    const value = parseNeedleGauge(gauge);
    if (value == null) errors.gauge = "Enter a whole-number gauge, such as 25 or 25G.";
    else spec.needle_gauge = value;
  }
  if (length) {
    const value = parseNeedleLength(length, unit);
    if (value == null) errors.length = "Enter a positive length, such as 5/8 inches or 16 mm.";
    else spec.needle_length_in = value;
  }
  const markingsMode = field("markings_mode");
  if (markingsMode === "count" || markingsMode === "spacing") {
    const cap = spec.capacity_mL;
    const raw = field("markings_value");
    const count = Number(raw);
    const spacing = markingsMode === "count"
      ? cap && raw && Number.isInteger(count) && count > 0 ? cap / count : null
      : cap ? syringeMarkSpacing(raw, cap) : null;
    if (!cap) errors.capacity = "Enter the syringe capacity to work out its markings.";
    if (!spacing || !Number.isFinite(spacing)) errors.markings = markingsMode === "count"
      ? "Enter the number of equal spaces from zero to full capacity, such as 10."
      : "Enter the mL between neighboring lines, no greater than the syringe capacity.";
    else spec.unit_markings = `${spacing} mL increments`;
  } else if (markingsMode !== "unknown" && field("unit_markings")) spec.unit_markings = field("unit_markings");
  if (requireCapacityForDetails && !capacity && (gauge || length || spec.unit_markings)) {
    errors.capacity = "Enter the syringe capacity, or clear its details.";
  }
  return { spec, errors };
}
