"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  animate,
} from "motion/react";
import { complianceColour } from "@/lib/colours";
import type { WheelDay, WheelModel } from "@/lib/adherence";

// Draggable date-wheel (PRD §5.4, §9). A horizontal strip of days, today
// centred, ≥8 always visible, scrub ±rangeDays with momentum + snap. Each day
// shows its adherence grade (a factual record colour) and per-medication
// identity dots. Selection commits on drag-settle and on tap. Never animates a
// logged dose; respects reduced-motion.

const CELL_W = 44; // px — at 320px viewport, floor(320/44) ≥ 7; with padding ≥ 8 fit
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** The cell's grade fill + text colour. A factual record, not a judgement.
 *  The fill is a full-opacity point on the red→yellow→sage→green ramp keyed to
 *  how complete the day was. */
function cellStyle(day: WheelDay): { background: string; colour: string } {
  // Future, nothing due, or today with nothing logged yet → neutral.
  if (!day.graded || day.status === "none") {
    return { background: "transparent", colour: "var(--color-paper)" };
  }
  // Today is in progress: never the red/orange end. Below half-done it stays
  // neutral; at or above half it fills yellow→green as it completes.
  if (day.timeClass === "today" && day.ratio < 0.5) {
    return { background: "transparent", colour: "var(--color-paper)" };
  }
  return { background: complianceColour(day.ratio), colour: "var(--color-on-accent)" };
}

export function DateWheel({
  model,
  selectedKey,
  onSelect,
  onScrub,
}: {
  model: WheelModel;
  selectedKey: string;
  onSelect: (key: string) => void;
  // Fires (with the centred day's ms) each time the centred day changes —
  // including mid-drag — so a synced view (e.g. the amount-in-system chart) can
  // track the wheel. Optional: the standalone calendar ignores it.
  onScrub?: (ms: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const x = useMotionValue(0);
  const reduce = useReducedMotion();
  const movedRef = useRef(false);
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;

  const total = model.days.length;
  const selectedIndex = Math.max(
    0,
    model.days.findIndex((d) => d.key === selectedKey)
  );
  const [headerIndex, setHeaderIndex] = useState(selectedIndex);

  const half = containerW / 2;
  const offsetForIndex = (i: number) => half - (i * CELL_W + CELL_W / 2);
  const indexFromX = (xv: number) =>
    clamp(Math.round((half - xv - CELL_W / 2) / CELL_W), 0, total - 1);

  // Measure container and centre the selected day before paint (no flash).
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setContainerW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // When width or selection changes, recentre (instant on first measure).
  useLayoutEffect(() => {
    if (containerW === 0) return;
    const target = offsetForIndex(selectedIndex);
    if (x.get() === 0 || reduce) {
      x.set(target);
    } else {
      animate(x, target, { type: "spring", stiffness: 320, damping: 36 });
    }
    setHeaderIndex(selectedIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerW, selectedKey]);

  // Keep the month/year header — and any synced view (onScrub) — in step with
  // the centred day during a drag.
  const scrubIndexRef = useRef(selectedIndex);
  useLayoutEffect(() => {
    const unsub = x.on("change", (xv) => {
      const i = indexFromX(xv);
      if (i === scrubIndexRef.current) return;
      scrubIndexRef.current = i;
      setHeaderIndex(i);
      const ms = model.days[i]?.ms;
      if (ms != null) onScrubRef.current?.(ms);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerW, total]);

  const settleTo = (index: number) => {
    const i = clamp(index, 0, total - 1);
    const target = offsetForIndex(i);
    if (reduce) x.set(target);
    else animate(x, target, { type: "spring", stiffness: 320, damping: 36 });
    onSelect(model.days[i].key);
  };

  const headerLabel = model.days[headerIndex]
    ? new Date(model.days[headerIndex].ms).toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
      })
    : "";

  const dragLeft = offsetForIndex(total - 1);
  const dragRight = offsetForIndex(0);

  // A single-medication wheel has at most one dot per day — render it larger and
  // centred under the weekday/number rather than in the multi-dot grid.
  const singleMed = model.legend.length <= 1;

  return (
    <div
      className="select-none"
      role="group"
      aria-label="Medication calendar — drag to change date"
    >
      {/* Month / year — updates as you scrub */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-paper tabular" aria-live="polite">
          {headerLabel}
        </span>
        <span className="text-[11px] text-faint">⟷ drag</span>
      </div>

      <div
        ref={containerRef}
        className="relative overflow-hidden"
        tabIndex={0}
        role="listbox"
        aria-label="Dates"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            settleTo(selectedIndex - 1);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            settleTo(selectedIndex + 1);
          } else if (e.key === "Home") {
            e.preventDefault();
            settleTo(model.todayIndex);
          } else if (e.key === "PageUp") {
            e.preventDefault();
            settleTo(selectedIndex - 7);
          } else if (e.key === "PageDown") {
            e.preventDefault();
            settleTo(selectedIndex + 7);
          }
        }}
      >
        {/* Centre marker — the obvious "selected slot" + drag affordance */}
        <div
          className="pointer-events-none absolute left-1/2 top-0 z-10 h-full -translate-x-1/2"
          aria-hidden
        >
          <div className="mx-auto h-0 w-0 border-x-4 border-t-4 border-x-transparent border-t-accent" />
        </div>
        {/* Edge fades */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-ink to-transparent" aria-hidden />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-ink to-transparent" aria-hidden />

        <motion.div
          className="flex cursor-grab active:cursor-grabbing"
          style={{ x, width: total * CELL_W, touchAction: "pan-y" }}
          drag="x"
          dragConstraints={{ left: dragLeft, right: dragRight }}
          dragElastic={0.06}
          // Reset on every pointer-down (a pure tap never fires onDragStart, so
          // without this the flag stays true after a drag and taps get ignored).
          onPointerDown={() => {
            movedRef.current = false;
          }}
          onDragStart={() => {
            movedRef.current = false;
          }}
          onDrag={(_, info) => {
            if (Math.abs(info.offset.x) > 8) movedRef.current = true;
          }}
          onDragEnd={(_, info) => {
            // A tap (no real movement) is handled by the cell's onClick — don't
            // let a zero-distance drag-end snap back over the tapped date.
            if (!movedRef.current) return;
            // Project momentum a little, then snap to the nearest day.
            const projected = x.get() + info.velocity.x * 0.06;
            settleTo(indexFromX(projected));
          }}
        >
          {model.days.map((day, i) => (
            <DateCell
              key={day.key}
              day={day}
              selected={i === selectedIndex}
              singleMed={singleMed}
              onTap={() => {
                if (movedRef.current) return; // it was a drag, not a tap
                settleTo(i);
              }}
            />
          ))}
        </motion.div>
      </div>
    </div>
  );
}

function DateCell({
  day,
  selected,
  singleMed,
  onTap,
}: {
  day: WheelDay;
  selected: boolean;
  singleMed: boolean;
  onTap: () => void;
}) {
  const { background, colour } = cellStyle(day);
  // Up to 6 dots, 3 per row over two rows, so the dot cluster stays narrow and
  // days read as separate columns. Beyond 6, show 5 + "+N".
  const MAX_DOTS = 6;
  const overflow = day.meds.length > MAX_DOTS;
  const shownMeds = overflow ? day.meds.slice(0, MAX_DOTS - 1) : day.meds.slice(0, MAX_DOTS);
  const extra = day.meds.length - shownMeds.length;

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={`${new Date(day.ms).toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })}${day.graded && day.status !== "none" ? `, ${day.status}` : ""}`}
      onClick={onTap}
      style={{ width: CELL_W }}
      className="flex shrink-0 flex-col items-center gap-1 py-2"
    >
      <span className="text-[10px] uppercase text-faint">
        {WEEKDAY_LETTERS[day.weekdayIndex]}
      </span>

      {/* Per-medication dots. Solid = taken in full (right dose, right number of
          times); empty ring = not (yet). A single-medication wheel shows one
          larger, centred dot; multi-med shows 3 per row over up to two rows. */}
      {singleMed ? (
        <span className="flex min-h-[16px] items-center justify-center">
          {shownMeds[0]
            ? (() => {
                const m = shownMeds[0];
                const full = m.takenInFull >= m.scheduled;
                return (
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={
                      full
                        ? { backgroundColor: m.colour }
                        : { border: `2px solid ${m.colour}` }
                    }
                  />
                );
              })()
            : null}
        </span>
      ) : (
        <span className="grid min-h-[16px] grid-cols-3 content-start justify-items-center gap-0.5">
          {shownMeds.map((m) => {
            const full = m.takenInFull >= m.scheduled;
            return (
              <span
                key={m.medId}
                className="h-1.5 w-1.5 rounded-full"
                style={
                  full
                    ? { backgroundColor: m.colour }
                    : { border: `1.5px solid ${m.colour}` }
                }
              />
            );
          })}
          {extra > 0 ? (
            <span className="text-[8px] leading-none text-faint">+{extra}</span>
          ) : null}
        </span>
      )}

      {/* Day number — sits in the grade fill */}
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full text-sm tabular ${
          day.isToday ? "ring-1 ring-accent" : ""
        } ${selected ? "outline outline-1 outline-paper" : ""}`}
        style={{ background, color: colour }}
      >
        {day.dayOfMonth}
      </span>
    </button>
  );
}
