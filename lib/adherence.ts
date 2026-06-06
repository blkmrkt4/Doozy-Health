import { occurrencesInWindow, dayKey, startOfDay, dayWindow } from "@/lib/schedule";
import { type Frequency } from "@/lib/types";

// Adherence grading (PRD §5.4, §6.1, §9). A FACTUAL record of logged-versus-
// scheduled doses, used to colour the medication calendar. This is information
// ("what you logged"), never an instruction or a score: today is never graded
// as "missed" (the day is in progress), and the future shows scheduled doses
// only. All maths is deterministic and `nowMs`-injected — no LLM (hard rule #8).
// Local-time day bucketing is shared with lib/schedule.ts so the two never drift.

const MS_DAY = 24 * 3_600_000;

// ── Inputs ──────────────────────────────────────────────────────────────────

/** A medication's active chosen regimen, assembled from chosen_regimens. */
export type MedRegimen = {
  medicationId: string;
  frequency: Frequency;
  anchorMs: number; // when the chosen regimen began (created_at)
  doseAmount: number;
  doseUnit: string;
  colour: string; // resolved identity hex (medications.colour)
};

/** A single dose_logs row already filtered to event_type = 'taken'. */
export type TakenLog = {
  medicationId: string;
  loggedAtMs: number;
  amount: number | null;
  unit: string | null;
};

// ── Outputs ─────────────────────────────────────────────────────────────────

export type MedDayStatus = "none" | "full" | "partial" | "missed";
export type DayTimeClass = "past" | "today" | "future";

export type MedDayCompliance = {
  medicationId: string;
  scheduled: number;
  taken: number;
  takenInFull: number;
  status: MedDayStatus;
};

export type DayMedMark = {
  medId: string;
  colour: string;
  scheduled: number;
  logged: number; // 'taken' count that day
  takenInFull: number;
};

export type WheelDay = {
  key: string; // local YYYY-MM-DD
  ms: number; // local midnight
  dayOfMonth: number;
  weekdayIndex: number; // 0 = Sun … 6 = Sat
  isToday: boolean;
  timeClass: DayTimeClass;
  status: MedDayStatus; // day aggregate, time-adjusted
  ratio: number; // 0..1, drives the orange gradient
  graded: boolean; // false for future days
  meds: DayMedMark[]; // only meds scheduled or logged that day
};

export type WheelModel = {
  days: WheelDay[]; // length 2*rangeDays + 1; today at todayIndex
  todayIndex: number;
  rangeDays: number;
  legend: { medId: string; colour: string }[];
};

// A single dose_log surfaced in the agenda for display + delete. Plain
// serializable shape (server component → client component).
export type DayLog = {
  id: string;
  medId: string;
  loggedAtMs: number;
  eventType: "taken" | "prn" | "skipped";
  amount: number | null;
  unit: string | null;
};

// Per-medication context the agenda's "Taken" control needs. Injectable fields
// are null for non-injectables.
export type MedLogMeta = {
  medId: string;
  name: string;
  colour: string;
  defaultAmount: number; // chosen regimen dose_amount
  defaultUnit: string; // chosen regimen dose_unit (the storage unit)
  defaultRoute: string;
  isInjectable: boolean;
  concentrationAmount: number | null;
  concentrationPerVolume: number | null;
  syringeCapacityMl: number | null;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** DST-safe: the local midnight `n` days from a day-start. */
function addDays(dayStartMs: number, n: number): number {
  const d = new Date(dayStartMs);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Tolerant numeric equality for dose amounts (numerics arrive as strings). */
function amountsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

// ── Per-medication, per-day ─────────────────────────────────────────────────

/**
 * Grade one medication on one day from its regimen and that day's 'taken' logs.
 * "In full" requires a matching unit and amount; a reduced or differently-united
 * dose counts as taken but not in full, yielding `partial`. "Due 3×, took 2"
 * likewise yields `partial`.
 */
export function medDayCompliance(
  reg: MedRegimen,
  takenLogsForDay: TakenLog[],
  dayStartMs: number,
  dayEndMs: number
): MedDayCompliance {
  const scheduled = occurrencesInWindow(
    reg.frequency,
    reg.anchorMs,
    dayStartMs,
    dayEndMs
  ).length;
  const taken = takenLogsForDay.length;
  let takenInFull = 0;
  for (const log of takenLogsForDay) {
    if (
      log.amount != null &&
      log.unit === reg.doseUnit &&
      amountsMatch(log.amount, reg.doseAmount)
    ) {
      takenInFull++;
    }
  }

  let status: MedDayStatus;
  if (scheduled === 0) status = "none";
  else if (taken === 0) status = "missed";
  else if (taken >= scheduled && takenInFull >= scheduled) status = "full";
  else status = "partial";

  return { medicationId: reg.medicationId, scheduled, taken, takenInFull, status };
}

export function classifyDay(dayStartMs: number, nowMs: number): DayTimeClass {
  const today = startOfDay(nowMs);
  const day = startOfDay(dayStartMs);
  if (day < today) return "past";
  if (day > today) return "future";
  return "today";
}

// ── Day aggregate ───────────────────────────────────────────────────────────

export type DayGrade = {
  status: MedDayStatus;
  ratio: number;
  perMed: MedDayCompliance[];
  timeClass: DayTimeClass;
  graded: boolean;
  dueTotal: number;
  creditTotal: number;
};

/**
 * Aggregate every medication's status for a day into one grade. A below-full
 * dose earns half credit, capped at scheduled, so a day with one fully-taken
 * med and one half-taken med reads as a graduated middle rather than binary.
 * Time rules: past graded normally (may be `missed`); today graded but never
 * `missed` (in progress); future not graded (scheduled dots only).
 */
export function gradeDay(
  regimens: MedRegimen[],
  takenByMed: Map<string, TakenLog[]>,
  dayStartMs: number,
  nowMs: number
): DayGrade {
  const dayEndMs = addDays(dayStartMs, 1);
  const timeClass = classifyDay(dayStartMs, nowMs);

  const perMed = regimens.map((reg) =>
    medDayCompliance(reg, takenByMed.get(reg.medicationId) ?? [], dayStartMs, dayEndMs)
  );

  let dueTotal = 0;
  let creditTotal = 0;
  for (const c of perMed) {
    dueTotal += c.scheduled;
    const credit = Math.min(
      c.takenInFull + 0.5 * (c.taken - c.takenInFull),
      c.scheduled
    );
    creditTotal += Math.max(0, credit);
  }
  const ratio = dueTotal === 0 ? 0 : creditTotal / dueTotal;

  let status: MedDayStatus;
  if (timeClass === "future" || dueTotal === 0) status = "none";
  else if (ratio >= 1) status = "full";
  else if (ratio === 0) status = "missed";
  else status = "partial";

  // Today is in progress: scheduled-but-not-yet-taken must not read as failure.
  if (timeClass === "today" && status === "missed") status = "none";

  return {
    status,
    ratio,
    perMed,
    timeClass,
    graded: timeClass !== "future",
    dueTotal,
    creditTotal,
  };
}

// ── Wheel model ─────────────────────────────────────────────────────────────

/**
 * Build the flat day strip the date-wheel renders: 2*rangeDays + 1 days centred
 * on today. Each day carries its aggregate grade plus per-medication marks
 * (only meds scheduled or logged that day) for the colour-coded dots.
 */
export function buildWheelModel(opts: {
  nowMs: number;
  rangeDays?: number;
  regimens: MedRegimen[];
  takenLogs: TakenLog[];
}): WheelModel {
  const rangeDays = opts.rangeDays ?? 50;
  const { startMs, endMs } = dayWindow(opts.nowMs, rangeDays);
  const todayStart = startOfDay(opts.nowMs);

  // Bucket 'taken' logs by day key, then by medication, once.
  const takenByDay = new Map<string, Map<string, TakenLog[]>>();
  for (const log of opts.takenLogs) {
    if (log.loggedAtMs < startMs || log.loggedAtMs >= endMs) continue;
    const k = dayKey(log.loggedAtMs);
    let byMed = takenByDay.get(k);
    if (!byMed) {
      byMed = new Map();
      takenByDay.set(k, byMed);
    }
    const arr = byMed.get(log.medicationId) ?? [];
    arr.push(log);
    byMed.set(log.medicationId, arr);
  }

  const days: WheelDay[] = [];
  for (let i = -rangeDays; i <= rangeDays; i++) {
    const dayStart = addDays(todayStart, i);
    const k = dayKey(dayStart);
    const byMed = takenByDay.get(k) ?? new Map<string, TakenLog[]>();
    const grade = gradeDay(opts.regimens, byMed, dayStart, opts.nowMs);

    const colourByMed = new Map(opts.regimens.map((r) => [r.medicationId, r.colour]));
    // Only meds actually scheduled that day get a dot — a med not due that day
    // does not appear at all (PRD §5.4).
    const meds: DayMedMark[] = grade.perMed
      .filter((c) => c.scheduled > 0)
      .map((c) => ({
        medId: c.medicationId,
        colour: colourByMed.get(c.medicationId) ?? "#777777",
        scheduled: c.scheduled,
        logged: c.taken,
        takenInFull: c.takenInFull,
      }));

    const d = new Date(dayStart);
    days.push({
      key: k,
      ms: dayStart,
      dayOfMonth: d.getDate(),
      weekdayIndex: d.getDay(),
      isToday: dayStart === todayStart,
      timeClass: grade.timeClass,
      status: grade.status,
      ratio: grade.ratio,
      graded: grade.graded,
      meds,
    });
  }

  return {
    days,
    todayIndex: rangeDays,
    rangeDays,
    legend: opts.regimens.map((r) => ({ medId: r.medicationId, colour: r.colour })),
  };
}
