"use client";

import { useState } from "react";
import { DateWheel } from "@/app/_components/date-wheel";
import { DayAgenda } from "@/app/_components/day-agenda";
import { COMPLIANCE_COLOURS } from "@/lib/colours";
import type { WheelModel, DayLog, MedLogMeta } from "@/lib/adherence";
import type { TrackedField, DiaryEntry } from "@/lib/types";

// Medication calendar section (PRD §5.4, §9). Owns the selected-day state and
// composes the draggable wheel with the inline agenda. The single component the
// dashboard and the medication detail page both import.

function StatusLegend() {
  const items: { label: string; colour: string }[] = [
    { label: "all", colour: COMPLIANCE_COLOURS.full },
    { label: "nearly", colour: COMPLIANCE_COLOURS.nearly },
    { label: "half", colour: COMPLIANCE_COLOURS.partial },
    { label: "missed", colour: COMPLIANCE_COLOURS.missed },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-faint">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: i.colour }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function CalendarSection({
  model,
  medNames,
  variant = "full",
  dayLogs,
  medMeta,
  canLog = false,
  initialDayKey,
  diaryFields,
  diaryEntriesByDay,
}: {
  model: WheelModel;
  medNames: Record<string, string>;
  // "full" = legend + wheel + agenda (the overall calendar / detail page).
  // "bar" = just the wheel, for a compact per-drug calendar inside a card.
  variant?: "full" | "bar";
  dayLogs?: DayLog[];
  medMeta?: Record<string, MedLogMeta>;
  canLog?: boolean;
  // The server page passes the ?day it was loaded with, so logging/deleting
  // (which round-trips through a server action) doesn't snap back to today.
  initialDayKey?: string;
  diaryFields?: TrackedField[];
  diaryEntriesByDay?: Map<string, DiaryEntry>;
}) {
  const todayKey = model.days[model.todayIndex]?.key ?? model.days[0]?.key;
  const initialKey =
    initialDayKey && model.days.some((d) => d.key === initialDayKey)
      ? initialDayKey
      : todayKey;
  const [selectedKey, setSelectedKey] = useState(initialKey);

  const selectedDay = model.days.find((d) => d.key === selectedKey) ?? null;

  if (variant === "bar") {
    return (
      <DateWheel model={model} selectedKey={selectedKey} onSelect={setSelectedKey} />
    );
  }

  return (
    <section className="mb-10 rounded-md border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium text-muted">Calendar</h2>
        <StatusLegend />
      </div>

      <DateWheel model={model} selectedKey={selectedKey} onSelect={setSelectedKey} />

      <DayAgenda
        day={selectedDay}
        medNames={medNames}
        dayLogs={dayLogs}
        medMeta={medMeta}
        canLog={canLog}
        diaryFields={diaryFields}
        diaryEntriesByDay={diaryEntriesByDay}
      />

      <p className="mt-3 text-xs text-faint">
        A record of what you&rsquo;ve logged against your schedule. Not medical
        advice.
      </p>
    </section>
  );
}
