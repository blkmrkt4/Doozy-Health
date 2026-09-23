import {
  DOSE_UNITS, ROUTES, isFrequency, isTimeZone, type DoseUnit, type Frequency, type Route,
} from "@/lib/types";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const PLAIN_ROUTES: Record<Route, string> = {
  oral: "by mouth", sublingual: "under the tongue",
  intramuscular: "by injection into a muscle", subcutaneous: "by injection under the skin",
  transdermal: "through a skin patch", suppository: "as a suppository",
  topical: "on the skin", inhaled: "by inhalation", ophthalmic: "in the eyes",
  otic: "in the ears", nasal: "in the nose",
};

export function readableNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value !== 0 && Math.abs(value) < 0.01 ? 6 : 2 }).format(value);
}

export function readableTime(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  if (hour === 0 && minute === 0) return "midnight";
  if (hour === 12 && minute === 0) return "noon";
  const period = hour < 12 ? "in the morning" : hour < 17 ? "in the afternoon" : hour < 21 ? "in the evening" : "at night";
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "am" : "pm"} ${period}`;
}

export function readableDays(days: number[]): string {
  return days.length === 7 ? "every day" : `on ${new Intl.ListFormat("en-US", { type: "conjunction" }).format(
    [...days].sort((a, b) => a - b).map((d) => WEEKDAYS[d - 1])
  )}`;
}

export function describeFrequency(f: Frequency): string {
  if (f.type === "weekly") return f.time === null ? `${readableDays(f.days)}, with no set time of day` : `${readableDays(f.days)} at ${readableTime(f.time)} (${f.time_zone})`;
  if (f.type === "as_needed") return "as needed, with no fixed schedule";
  if (f.type === "times_per") return `${f.count} ${f.count === 1 ? "time" : "times"} per ${f.period}`;
  return f.interval === 1 ? `every ${f.unit}` : `every ${f.interval} ${f.unit}s`;
}

export type RegimenInput = { dose_amount: number; dose_unit: DoseUnit; route: Route; frequency: Frequency };

export function describePlan(plan: RegimenInput, name: string): string {
  const f = plan.frequency;
  const medication = name.trim() ? ` of ${name.trim()}` : "";
  const route = PLAIN_ROUTES[plan.route];
  if (f.type !== "weekly") return `${readableNumber(plan.dose_amount)} ${plan.dose_unit}${medication} ${route}, ${describeFrequency(f)}.`;
  const total = f.weekly_total ?? plan.dose_amount * f.days.length;
  const rounded = Math.abs(plan.dose_amount - Number(plan.dose_amount.toFixed(plan.dose_amount < 0.01 ? 6 : 2))) > 1e-10;
  return `${readableNumber(total)} ${plan.dose_unit}${medication} ${route} each week, ${f.days.length === 1 ? "as one dose" : `divided into ${f.days.length} equal doses`}. That is ${rounded ? "approximately " : ""}${readableNumber(plan.dose_amount)} ${plan.dose_unit} ${describeFrequency(f)}.`;
}

/** Shared client/server parser; a posted hidden dose is never trusted for a
 * weekly-total split. Division is repeated here using the validated day count. */
export function parsePlanFrequency(fd: FormData, prefix: string): Frequency | null {
  const value = (key: string) => String(fd.get(`${prefix}_${key}`) ?? "");
  const type = value("type");
  let candidate: unknown;
  if (type === "weekly") {
    candidate = { type, days: fd.getAll(`${prefix}_days`).map(Number).sort((a, b) => a - b), time: value("time_unspecified") === "on" ? null : value("time"), time_zone: value("time_zone") };
  } else if (type === "every") {
    candidate = { type, interval: Number(value("interval")), unit: value("unit") };
  } else if (type === "times_per") {
    candidate = { type, count: Number(value("count")), period: value("period") };
  } else if (type === "as_needed") candidate = { type };
  return isFrequency(candidate) ? candidate : null;
}

export function readRegimenInput(fd: FormData, prefix: string): RegimenInput | null {
  const frequency = parsePlanFrequency(fd, `${prefix}_freq`);
  const dose_unit = String(fd.get(`${prefix}_dose_unit`) ?? "") as DoseUnit;
  const route = String(fd.get(`${prefix}_route`) ?? "") as Route;
  let dose_amount = Number(fd.get(`${prefix}_dose_amount`));
  if (!frequency || !DOSE_UNITS.includes(dose_unit) || !ROUTES.includes(route)) return null;
  if (fd.get(`${prefix}_amount_basis`) === "weekly_total") {
    if (frequency.type !== "weekly") return null;
    const total = Number(fd.get(`${prefix}_weekly_total`));
    if (!Number.isFinite(total) || total <= 0) return null;
    frequency.weekly_total = total;
    dose_amount = total / frequency.days.length;
  }
  if (!Number.isFinite(dose_amount) || dose_amount <= 0) return null;
  return { dose_amount, dose_unit, route, frequency };
}

export function weeklyTotal(plan: RegimenInput): number | null {
  const f = plan.frequency;
  if (f.type === "weekly") return f.weekly_total ?? plan.dose_amount * f.days.length;
  if (f.type === "as_needed" || (f.type === "every" && f.unit === "month")) return null;
  if (f.type === "times_per") return plan.dose_amount * f.count * (f.period === "week" ? 1 : 7);
  return plan.dose_amount * ({ hour: 168, day: 7, week: 1 }[f.unit as "hour" | "day" | "week"]) / f.interval;
}

/** Explain the first missing detail instead of leaving a disabled save unexplained. */
export function regimenInputIssue(fd: FormData, prefix: string): string | null {
  if (readRegimenInput(fd, prefix)) return null;
  const value = (name: string) => String(fd.get(`${prefix}_${name}`) ?? "");
  const total = value("amount_basis") === "weekly_total";
  const amount = Number(value(total ? "weekly_total" : "dose_amount"));
  if (!Number.isFinite(amount) || amount <= 0) return total ? "Enter the total for the week." : "Enter the amount each time.";
  if (value("freq_type") === "weekly") {
    if (!fd.getAll(`${prefix}_freq_days`).length) return "Choose at least one day of the week.";
    if (value("freq_time_unspecified") !== "on" && !value("freq_time")) return "Choose a time, or select N/A.";
    if (!isTimeZone(value("freq_time_zone"))) return "Enter a valid time zone.";
  }
  return "Check the amount, units, route, and schedule.";
}
