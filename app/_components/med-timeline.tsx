"use client";

import { useState, type ComponentProps } from "react";
import { DateWheel } from "@/app/_components/date-wheel";
import { AmountInSystemChart } from "@/app/_components/amount-in-system-chart";
import type { WheelModel } from "@/lib/adherence";

// Per-medication timeline (PRD §5.4 / §5.7): the draggable calendar wheel and
// the amount-in-system chart sharing ONE date axis. The wheel is the single
// scrubber — its centred date drives a movable read-out line on the chart
// below, while the chart's Today line stays fixed. Dragging the wheel moves the
// chart's line "the way you move the calendar"; resting on today shows just the
// one line. This replaces the chart's own (duplicate, mis-scaled) day strip.

type ChartProps = Omit<ComponentProps<typeof AmountInSystemChart>, "cursorDate">;

export function MedTimeline({
  wheelModel,
  chart,
}: {
  wheelModel: WheelModel;
  chart: ChartProps;
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
    </div>
  );
}
