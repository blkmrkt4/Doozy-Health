"use client";

import { motion, useReducedMotion } from "motion/react";
import { dayKey } from "@/lib/schedule";
import { MedDoseRow } from "@/app/_components/med-dose-row";
import { DiaryDayForm } from "@/app/_components/diary-day-form";
import type { WheelDay, DayLog, MedLogMeta } from "@/lib/adherence";
import type { TrackedField, DiaryEntry } from "@/lib/types";

// Inline agenda for the day selected in the wheel (PRD §5.4, §9). Each scheduled
// medication is one streamlined row: name, an editable dose, status, and a
// right-aligned row of green check-dots (one per scheduled dose) the user taps
// to log or undo.

export function DayAgenda({
  day,
  medNames,
  dayLogs,
  medMeta,
  canLog = false,
  diaryFields,
  diaryEntriesByDay,
}: {
  day: WheelDay | null;
  medNames: Record<string, string>;
  dayLogs?: DayLog[];
  medMeta?: Record<string, MedLogMeta>;
  canLog?: boolean;
  diaryFields?: TrackedField[];
  diaryEntriesByDay?: Map<string, DiaryEntry>;
}) {
  const reduce = useReducedMotion();
  if (!day) return null;

  const fullDate = new Date(day.ms).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Ordered (oldest first) taken-log ids for a med on this day — for undo.
  const takenIds = (medId: string): string[] =>
    (dayLogs ?? [])
      .filter(
        (l) =>
          l.medId === medId &&
          l.eventType === "taken" &&
          dayKey(l.loggedAtMs) === day.key
      )
      .sort((a, b) => a.loggedAtMs - b.loggedAtMs)
      .map((l) => l.id);

  return (
    <motion.div
      key={day.key}
      initial={reduce ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="mt-4 rounded-md border border-line bg-surface p-4"
    >
      <h3 className="text-sm font-medium text-paper">
        {fullDate}
        {day.isToday ? (
          <span className="ml-2 text-xs text-accent">today</span>
        ) : (
          <span className="ml-2 text-xs text-faint">not today</span>
        )}
      </h3>

      {day.meds.length === 0 ? (
        <p className="mt-2 text-sm text-faint">Nothing scheduled.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {day.meds.map((m) => (
            <li key={m.medId}>
              <MedDoseRow
                meta={medMeta?.[m.medId]}
                medColour={m.colour}
                medName={medNames[m.medId] ?? "Medication"}
                scheduled={m.scheduled}
                logged={m.logged}
                logIds={takenIds(m.medId)}
                dayMs={day.ms}
                isToday={day.isToday}
                canLog={canLog}
              />
            </li>
          ))}
        </ul>
      )}

      {diaryFields ? (
        <DiaryDayForm
          dayDate={day.key}
          fields={diaryFields}
          entry={diaryEntriesByDay?.get(day.key) ?? null}
          medNames={medNames}
          canLog={canLog}
        />
      ) : null}
    </motion.div>
  );
}
