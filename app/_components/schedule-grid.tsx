import { type ScheduleGridModel } from "@/lib/schedule";

// Neutral schedule + log calendar (PRD §5.4, §9). Filled accent dot = a dose
// you logged (a diary record), hollow ring = a scheduled dose (information),
// faint dot = nothing scheduled. There is deliberately no "missed" state, no
// score, no streak, and no red — a past scheduled slot with no log reads the
// same quiet way as any other (CLAUDE.md rule #14, PRD §6.1). The grid shows
// dose events only, never medication names or amounts, so it carries no
// identifying health value and needs no privacy blur.

function Marker({
  logged,
  scheduled,
  isPast,
  size,
}: {
  logged: number;
  scheduled: number;
  isPast: boolean;
  size: string;
}) {
  if (logged > 0) {
    return (
      <span
        className={`${size} rounded-full bg-accent`}
        title={logged > 1 ? `${logged} doses logged` : "Dose logged"}
      />
    );
  }
  if (scheduled > 0) {
    // Hollow ring. Past-with-no-log stays neutral (fainter border), never red.
    return (
      <span
        className={`${size} rounded-full border ${isPast ? "border-line" : "border-faint"}`}
        title={isPast ? "Was scheduled" : "Scheduled"}
      />
    );
  }
  return <span className="h-1 w-1 rounded-full bg-line" />;
}

export function ScheduleGridLegend() {
  return (
    <div className="flex items-center gap-4 text-[11px] text-faint">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-accent" /> logged
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full border border-faint" /> scheduled
      </span>
    </div>
  );
}

export function ScheduleGrid({
  model,
  compact = false,
  showDates = false,
}: {
  model: ScheduleGridModel;
  /** Smaller cells for use inside a medication card. */
  compact?: boolean;
  /** Show the day-of-month number above each marker (calendar feel). */
  showDates?: boolean;
}) {
  const dot = compact ? "h-2 w-2" : "h-2.5 w-2.5";
  const cellH = compact ? "h-6" : "h-9";

  return (
    <div className="select-none">
      <div className="grid grid-cols-7 gap-1">
        {model.weekdayLabels.map((label) => (
          <div
            key={label}
            className="text-center text-[10px] uppercase tracking-wide text-faint"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="mt-1 space-y-1">
        {model.weeks.map((week) => (
          <div key={week.startKey} className="grid grid-cols-7 gap-1">
            {week.days.map((d) => (
              <div
                key={d.key}
                className={`flex flex-col items-center justify-center gap-0.5 rounded-sm ${cellH} ${
                  d.isToday ? "ring-1 ring-accent/50" : ""
                }`}
              >
                {showDates ? (
                  <span
                    className={`tabular text-[9px] leading-none ${
                      d.isToday ? "text-accent" : "text-faint"
                    }`}
                  >
                    {d.dayOfMonth}
                  </span>
                ) : null}
                <Marker
                  logged={d.logged}
                  scheduled={d.scheduled}
                  isPast={d.isPast}
                  size={dot}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
