"use client";

import { useState, type ComponentProps } from "react";
import { DateWheel } from "@/app/_components/date-wheel";
import { AmountInSystemChart } from "@/app/_components/amount-in-system-chart";
import { DiaryDayForm } from "@/app/_components/diary-day-form";
import type { WheelModel } from "@/lib/adherence";
import type { TrackedField, DiaryEntry } from "@/lib/types";

// Per-medication timeline (PRD §5.4 / §5.7 / §5.9): the draggable calendar wheel
// and the amount-in-system chart sharing ONE date axis, plus a per-medication
// Diary twisty. The wheel is the single scrubber — its centred date drives the
// chart's read-out line, and its selected day is what the diary edits, so the
// diary lives at the individual-medication level (not the overall calendar).
// Notes stay at the day level, so this med-scoped diary hides them.

type ChartProps = Omit<ComponentProps<typeof AmountInSystemChart>, "cursorDate">;

export function MedTimeline({
  wheelModel,
  chart,
  diaryFields,
  diaryEntriesByDay,
  medNames,
  canLog = false,
}: {
  wheelModel: WheelModel;
  chart: ChartProps;
  // This medication's scoped tracked fields. When provided, a per-card Diary
  // twisty for the day selected on the wheel is shown.
  diaryFields?: TrackedField[];
  diaryEntriesByDay?: Map<string, DiaryEntry>;
  medNames?: Record<string, string>;
  canLog?: boolean;
}) {
  const todayKey =
    wheelModel.days[wheelModel.todayIndex]?.key ?? wheelModel.days[0]?.key;
  const todayMs =
    wheelModel.days[wheelModel.todayIndex]?.ms ??
    chart.nowDate?.getTime() ??
    Date.now();

  const [selectedKey, setSelectedKey] = useState(todayKey);
  // The centred date drives the chart's read-out line. Starts on today, follows
  // the wheel mid-drag (onScrub) and commits on settle/tap (onSelect).
  const [cursorMs, setCursorMs] = useState(todayMs);

  return (
    <div className="mt-4 space-y-3">
      <DateWheel
        model={wheelModel}
        selectedKey={selectedKey}
        onSelect={(key) => {
          setSelectedKey(key);
          const day = wheelModel.days.find((d) => d.key === key);
          if (day) setCursorMs(day.ms);
        }}
        onScrub={(ms) => setCursorMs(ms)}
      />
      <AmountInSystemChart {...chart} cursorDate={new Date(cursorMs)} />
      {diaryFields ? (
        <DiaryDayForm
          dayDate={selectedKey}
          fields={diaryFields}
          entry={diaryEntriesByDay?.get(selectedKey) ?? null}
          medNames={medNames ?? {}}
          canLog={canLog}
          hideNotes
        />
      ) : null}
    </div>
  );
}
