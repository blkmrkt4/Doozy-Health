import { dayKey } from "@/lib/schedule";
import type { WheelModel, DayLog, MedLogMeta } from "@/lib/adherence";

// The simple-mode "Today" model (users.display_prefs.simple_mode). A factual
// regrouping of the adherence wheel's today/yesterday marks into the three
// buckets the Today list renders: doses still unlogged, doses logged, and
// medications with nothing scheduled today. Pure and deterministic — grading
// comes from buildWheelModel; nothing here is time-of-day: the frequency model
// carries no user-intended clock times, so grouping by morning/afternoon would
// present artifacts as schedule facts.

export type SimpleMedDay = {
  medId: string;
  scheduled: number;
  logged: number;
  /** Today's 'taken' log ids, oldest first — the undo path. */
  logIds: string[];
};

export type SimpleTodayModel = {
  todayMs: number;
  todayKey: string;
  /** Scheduled today with fewer logs than scheduled doses. */
  remaining: SimpleMedDay[];
  /** Scheduled today and fully logged. */
  done: SimpleMedDay[];
  /** Nothing scheduled today (as-needed or an off-cadence day). */
  unscheduled: SimpleMedDay[];
  /** Yesterday's factual shortfall, when any medication logged fewer than scheduled. */
  yesterday: {
    dayMs: number;
    dayKeyStr: string;
    shortfalls: { medId: string; scheduled: number; logged: number }[];
  } | null;
};

export function buildSimpleTodayModel(opts: {
  wheelModel: WheelModel;
  medMeta: Record<string, MedLogMeta>;
  dayLogs: DayLog[];
}): SimpleTodayModel {
  const { wheelModel, medMeta, dayLogs } = opts;
  const today = wheelModel.days[wheelModel.todayIndex];
  const yesterdayDay =
    wheelModel.todayIndex > 0
      ? wheelModel.days[wheelModel.todayIndex - 1]
      : undefined;

  const byName = (a: SimpleMedDay, b: SimpleMedDay) =>
    (medMeta[a.medId]?.name ?? "").localeCompare(medMeta[b.medId]?.name ?? "");

  const remaining: SimpleMedDay[] = [];
  const done: SimpleMedDay[] = [];
  const unscheduled: SimpleMedDay[] = [];

  for (const medId of Object.keys(medMeta)) {
    const mark = today?.meds.find((m) => m.medId === medId);
    const scheduled = mark?.scheduled ?? 0;
    const logged = mark?.logged ?? 0;
    const logIds = dayLogs
      .filter(
        (l) =>
          l.medId === medId &&
          l.eventType === "taken" &&
          dayKey(l.loggedAtMs) === today?.key
      )
      .sort((a, b) => a.loggedAtMs - b.loggedAtMs)
      .map((l) => l.id);
    const entry: SimpleMedDay = { medId, scheduled, logged, logIds };
    if (scheduled === 0) unscheduled.push(entry);
    else if (logged < scheduled) remaining.push(entry);
    else done.push(entry);
  }
  remaining.sort(byName);
  done.sort(byName);
  unscheduled.sort(byName);

  let yesterday: SimpleTodayModel["yesterday"] = null;
  if (yesterdayDay) {
    const shortfalls = yesterdayDay.meds
      .filter((m) => m.scheduled > m.logged && medMeta[m.medId])
      .map((m) => ({
        medId: m.medId,
        scheduled: m.scheduled,
        logged: m.logged,
      }))
      .sort((a, b) =>
        (medMeta[a.medId]?.name ?? "").localeCompare(medMeta[b.medId]?.name ?? "")
      );
    if (shortfalls.length > 0) {
      yesterday = {
        dayMs: yesterdayDay.ms,
        dayKeyStr: yesterdayDay.key,
        shortfalls,
      };
    }
  }

  return {
    todayMs: today?.ms ?? 0,
    todayKey: today?.key ?? "",
    remaining,
    done,
    unscheduled,
    yesterday,
  };
}
