import { type Frequency } from "@/lib/types";

// Schedule grid model (PRD §5.4, §5.5, §9). A neutral, illustrative calendar of
// when doses are *scheduled* (forward, from the chosen regimen) and when doses
// were *logged* (backward, from dose_logs). This is a diary/timeline view, NOT
// an adherence score: there is no streak, no completion percentage, no "missed"
// state, and no red/guilt colouring (CLAUDE.md rule #14, PRD §6.1). A past
// scheduled slot with no log is shown the same quiet way as any other scheduled
// slot — the chart shows, the user interprets.
//
// All maths here is deterministic. No LLM is involved (hard rule #8). Every
// time-dependent function takes `nowMs` so it is pure and testable.

const MS_HOUR = 3_600_000;
const MS_DAY = 24 * MS_HOUR;

/**
 * Convert a cadence to a fixed inter-dose interval in milliseconds.
 * Returns null for `as_needed` (no scheduled occurrences — only logs appear).
 * Mirrors the reminders engine (lib/reminders.ts) so the calendar and the
 * reminder schedule agree on cadence.
 */
export function frequencyIntervalMs(freq: Frequency): number | null {
  if (freq.type === "as_needed") return null;
  if (freq.type === "every") {
    const multiplier: Record<string, number> = {
      hour: MS_HOUR,
      day: MS_DAY,
      week: MS_DAY * 7,
      month: MS_DAY * 30,
    };
    return freq.interval * (multiplier[freq.unit] ?? MS_DAY);
  }
  if (freq.type === "times_per") {
    const periodMs = freq.period === "week" ? MS_DAY * 7 : MS_DAY;
    return periodMs / freq.count;
  }
  return null;
}

/**
 * Occurrence timestamps (ms) for a cadence within the half-open window
 * [startMs, endMs), aligned to `anchorMs` (e.g. when the chosen regimen began).
 * Deterministic; returns [] for as_needed.
 */
export function occurrencesInWindow(
  freq: Frequency,
  anchorMs: number,
  startMs: number,
  endMs: number
): number[] {
  const interval = frequencyIntervalMs(freq);
  if (!interval || interval <= 0 || endMs <= startMs) return [];

  // First occurrence at or after startMs, on the anchor's phase.
  const steps = Math.ceil((startMs - anchorMs) / interval);
  let t = anchorMs + steps * interval;

  const out: number[] = [];
  // Guard against a pathological sub-second interval producing a huge array.
  const maxPoints = 5000;
  while (t < endMs && out.length < maxPoints) {
    if (t >= startMs) out.push(t);
    t += interval;
  }
  return out;
}

// ── Grid model ──────────────────────────────────────────────────────────────

export type DayCell = {
  /** Local YYYY-MM-DD key. */
  key: string;
  /** Day of month (1–31), for the calendar label. */
  dayOfMonth: number;
  /** Count of doses logged on this day (event_type 'taken'). */
  logged: number;
  /** Count of scheduled occurrences falling on this day. */
  scheduled: number;
  isToday: boolean;
  /** Strictly before today (local midnight). */
  isPast: boolean;
};

export type WeekRow = { startKey: string; days: DayCell[] };

export type ScheduleGridModel = {
  weeks: WeekRow[];
  /** Mon–Sun, abbreviated for the column headers. */
  weekdayLabels: string[];
};

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday-aligned start of the week containing `ms` (local time). */
function startOfWeekMonday(ms: number): number {
  const dayStart = startOfDay(ms);
  const dow = (new Date(dayStart).getDay() + 6) % 7; // Mon=0 … Sun=6
  return dayStart - dow * MS_DAY;
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The week-aligned window the grid covers: from the Monday `weeksBefore` weeks
 * back, to the Sunday `weeksAfter` weeks ahead (end exclusive). Shared by the
 * occurrence generator and the grid builder so they always agree on bounds.
 */
export function gridWindow(
  nowMs: number,
  weeksBefore: number,
  weeksAfter: number
): { startMs: number; endMs: number } {
  const thisMonday = startOfWeekMonday(nowMs);
  const startMs = thisMonday - weeksBefore * 7 * MS_DAY;
  const endMs = thisMonday + (weeksAfter + 1) * 7 * MS_DAY; // exclusive
  return { startMs, endMs };
}

/**
 * A day-aligned window centred on today, spanning ±`rangeDays` (end exclusive).
 * Used by the date-wheel, which is a linear strip of days rather than the
 * week-aligned grid `gridWindow` produces.
 */
export function dayWindow(
  nowMs: number,
  rangeDays: number
): { startMs: number; endMs: number } {
  const today = startOfDay(nowMs);
  return {
    startMs: today - rangeDays * MS_DAY,
    endMs: today + (rangeDays + 1) * MS_DAY, // exclusive: includes day +rangeDays
  };
}

/**
 * Build the calendar model: a week-aligned grid with per-day logged and
 * scheduled counts. `scheduledMs` and `loggedMs` are flat timestamp arrays
 * (already aggregated across whichever medications the caller cares about).
 */
export function buildScheduleGrid(opts: {
  nowMs: number;
  weeksBefore?: number;
  weeksAfter?: number;
  scheduledMs?: number[];
  loggedMs?: number[];
}): ScheduleGridModel {
  const weeksBefore = opts.weeksBefore ?? 1;
  const weeksAfter = opts.weeksAfter ?? 2;
  const { startMs } = gridWindow(opts.nowMs, weeksBefore, weeksAfter);

  const todayKey = dayKey(opts.nowMs);
  const todayStart = startOfDay(opts.nowMs);

  // Bucket counts by day key.
  const loggedByDay = new Map<string, number>();
  for (const ms of opts.loggedMs ?? []) {
    const k = dayKey(ms);
    loggedByDay.set(k, (loggedByDay.get(k) ?? 0) + 1);
  }
  const scheduledByDay = new Map<string, number>();
  for (const ms of opts.scheduledMs ?? []) {
    const k = dayKey(ms);
    scheduledByDay.set(k, (scheduledByDay.get(k) ?? 0) + 1);
  }

  const totalWeeks = weeksBefore + 1 + weeksAfter;
  const weeks: WeekRow[] = [];
  for (let w = 0; w < totalWeeks; w++) {
    const weekStart = startMs + w * 7 * MS_DAY;
    const days: DayCell[] = [];
    for (let i = 0; i < 7; i++) {
      const cellMs = weekStart + i * MS_DAY;
      const k = dayKey(cellMs);
      days.push({
        key: k,
        dayOfMonth: new Date(cellMs).getDate(),
        logged: loggedByDay.get(k) ?? 0,
        scheduled: scheduledByDay.get(k) ?? 0,
        isToday: k === todayKey,
        isPast: startOfDay(cellMs) < todayStart,
      });
    }
    weeks.push({ startKey: dayKey(weekStart), days });
  }

  return {
    weeks,
    weekdayLabels: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
  };
}
