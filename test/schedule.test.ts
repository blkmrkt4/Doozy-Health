import { describe, it, expect } from "vitest";
import {
  frequencyIntervalMs,
  occurrencesInWindow,
  gridWindow,
  buildScheduleGrid,
} from "@/lib/schedule";
import type { Frequency } from "@/lib/types";

const MS_DAY = 24 * 3_600_000;

// A fixed local "now": midday so day-bucketing is timezone-robust across CI.
// 2024-01-10 is a Wednesday.
const NOW = new Date(2024, 0, 10, 12, 0, 0, 0).getTime();

describe("frequencyIntervalMs", () => {
  it("returns null for as_needed (no scheduled occurrences)", () => {
    expect(frequencyIntervalMs({ type: "as_needed" })).toBeNull();
  });

  it("handles every/day and every/week", () => {
    expect(frequencyIntervalMs({ type: "every", interval: 1, unit: "day" })).toBe(MS_DAY);
    expect(frequencyIntervalMs({ type: "every", interval: 1, unit: "week" })).toBe(7 * MS_DAY);
    expect(frequencyIntervalMs({ type: "every", interval: 2, unit: "day" })).toBe(2 * MS_DAY);
  });

  it("spreads times_per evenly across the period", () => {
    expect(frequencyIntervalMs({ type: "times_per", count: 3, period: "week" })).toBe(
      (7 * MS_DAY) / 3
    );
    expect(frequencyIntervalMs({ type: "times_per", count: 2, period: "day" })).toBe(MS_DAY / 2);
  });
});

describe("occurrencesInWindow", () => {
  it("returns [] for as_needed", () => {
    expect(
      occurrencesInWindow({ type: "as_needed" }, NOW, NOW, NOW + 7 * MS_DAY)
    ).toEqual([]);
  });

  it("is half-open: includes start, excludes end", () => {
    const daily: Frequency = { type: "every", interval: 1, unit: "day" };
    const out = occurrencesInWindow(daily, NOW, NOW, NOW + 3 * MS_DAY);
    expect(out).toEqual([NOW, NOW + MS_DAY, NOW + 2 * MS_DAY]);
  });

  it("aligns to the anchor phase, not the window start", () => {
    const weekly: Frequency = { type: "every", interval: 1, unit: "week" };
    const anchor = NOW; // Wednesday midday
    const out = occurrencesInWindow(weekly, anchor, NOW - 10 * MS_DAY, NOW + 10 * MS_DAY);
    // Every occurrence is a whole number of weeks from the anchor.
    for (const t of out) {
      expect(Math.abs((t - anchor) % (7 * MS_DAY))).toBe(0);
    }
    expect(out).toContain(NOW);
  });

  it("does not run away on sub-day cadences", () => {
    const hourly: Frequency = { type: "every", interval: 1, unit: "hour" };
    const out = occurrencesInWindow(hourly, NOW, NOW, NOW + MS_DAY);
    expect(out.length).toBe(24);
  });
});

describe("gridWindow / buildScheduleGrid", () => {
  it("covers a whole number of Monday-aligned weeks", () => {
    const { startMs, endMs } = gridWindow(NOW, 1, 2);
    expect(new Date(startMs).getDay()).toBe(1); // Monday
    expect((endMs - startMs) % (7 * MS_DAY)).toBe(0);
    expect((endMs - startMs) / (7 * MS_DAY)).toBe(4); // 1 before + this + 2 after
  });

  it("builds the right number of week rows and flags exactly one today", () => {
    const model = buildScheduleGrid({ nowMs: NOW, weeksBefore: 1, weeksAfter: 2 });
    expect(model.weeks).toHaveLength(4);
    expect(model.weeks.every((w) => w.days.length === 7)).toBe(true);
    const todays = model.weeks.flatMap((w) => w.days).filter((d) => d.isToday);
    expect(todays).toHaveLength(1);
    expect(todays[0]?.dayOfMonth).toBe(10);
  });

  it("buckets logged and scheduled counts onto the correct day", () => {
    const model = buildScheduleGrid({
      nowMs: NOW,
      weeksBefore: 1,
      weeksAfter: 2,
      loggedMs: [NOW, NOW], // two doses logged today
      scheduledMs: [NOW + MS_DAY], // one scheduled tomorrow
    });
    const all = model.weeks.flatMap((w) => w.days);
    const today = all.find((d) => d.isToday)!;
    const tomorrow = all.find((d) => d.key !== today.key && d.scheduled > 0)!;
    expect(today.logged).toBe(2);
    expect(tomorrow.scheduled).toBe(1);
  });

  it("marks days before today as past (never a 'missed' flag — neutral only)", () => {
    const model = buildScheduleGrid({ nowMs: NOW, weeksBefore: 1, weeksAfter: 2 });
    const all = model.weeks.flatMap((w) => w.days);
    const today = all.find((d) => d.isToday)!;
    const before = all.filter((d) => d.isPast);
    const after = all.filter((d) => !d.isPast && !d.isToday);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    expect(today.isPast).toBe(false);
  });
});
