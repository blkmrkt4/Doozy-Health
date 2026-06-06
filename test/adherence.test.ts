import { describe, it, expect } from "vitest";
import { complianceColour } from "@/lib/colours";
import { startOfDay, dayKey } from "@/lib/schedule";
import {
  medDayCompliance,
  classifyDay,
  gradeDay,
  buildWheelModel,
  type MedRegimen,
  type TakenLog,
} from "@/lib/adherence";
import type { Frequency } from "@/lib/types";

const MS_DAY = 24 * 3_600_000;

// Fixed local "now": 2024-01-10 (a Wednesday), midday so day-bucketing is
// timezone-robust across CI.
const NOW = new Date(2024, 0, 10, 12, 0, 0, 0).getTime();
const TODAY = startOfDay(NOW);

const daily: Frequency = { type: "every", interval: 1, unit: "day" };
const thrice: Frequency = { type: "times_per", count: 3, period: "day" };
const twice: Frequency = { type: "times_per", count: 2, period: "day" };

function reg(over: Partial<MedRegimen> = {}): MedRegimen {
  return {
    medicationId: "m1",
    frequency: daily,
    anchorMs: NOW,
    doseAmount: 50,
    doseUnit: "mg",
    colour: "#6AA9FF",
    ...over,
  };
}

function log(over: Partial<TakenLog> = {}): TakenLog {
  return { medicationId: "m1", loggedAtMs: NOW, amount: 50, unit: "mg", ...over };
}

describe("medDayCompliance", () => {
  it("full: due once, one full-dose log", () => {
    const c = medDayCompliance(reg(), [log()], TODAY, TODAY + MS_DAY);
    expect(c).toMatchObject({ scheduled: 1, taken: 1, takenInFull: 1, status: "full" });
  });

  it("partial: due 3×, took 2", () => {
    const c = medDayCompliance(reg({ frequency: thrice }), [log(), log()], TODAY, TODAY + MS_DAY);
    expect(c).toMatchObject({ scheduled: 3, taken: 2, takenInFull: 2, status: "partial" });
  });

  it("partial: due 3×, took 3 but one at a reduced dose", () => {
    const logs = [log(), log(), log({ amount: 25 })];
    const c = medDayCompliance(reg({ frequency: thrice }), logs, TODAY, TODAY + MS_DAY);
    expect(c).toMatchObject({ taken: 3, takenInFull: 2, status: "partial" });
  });

  it("partial: unit mismatch counts as taken, not in full", () => {
    const c = medDayCompliance(
      reg({ doseUnit: "tablet", doseAmount: 1 }),
      [log({ amount: 50, unit: "mg" })],
      TODAY,
      TODAY + MS_DAY
    );
    expect(c).toMatchObject({ scheduled: 1, taken: 1, takenInFull: 0, status: "partial" });
  });

  it("none: as_needed is never scheduled, so never graded", () => {
    const c = medDayCompliance(
      reg({ frequency: { type: "as_needed" } }),
      [log(), log()],
      TODAY,
      TODAY + MS_DAY
    );
    expect(c.scheduled).toBe(0);
    expect(c.status).toBe("none");
  });

  it("over-logging is clamped to full, never penalised", () => {
    const c = medDayCompliance(reg(), [log(), log()], TODAY, TODAY + MS_DAY);
    expect(c.status).toBe("full");
  });
});

describe("classifyDay", () => {
  it("classifies past / today / future", () => {
    expect(classifyDay(TODAY - MS_DAY, NOW)).toBe("past");
    expect(classifyDay(TODAY, NOW)).toBe("today");
    expect(classifyDay(TODAY + MS_DAY, NOW)).toBe("future");
  });
});

describe("gradeDay", () => {
  it("aggregate fold across meds yields a graduated ratio", () => {
    const a = reg({ medicationId: "a" });
    const b = reg({ medicationId: "b", frequency: twice });
    const taken = new Map<string, TakenLog[]>([
      ["a", [log({ medicationId: "a" })]],
      ["b", [log({ medicationId: "b" })]],
    ]);
    const g = gradeDay([a, b], taken, TODAY - MS_DAY, NOW); // past day
    expect(g.dueTotal).toBe(3); // 1 + 2
    expect(g.creditTotal).toBeCloseTo(2, 6); // a:1 + b:1
    expect(g.ratio).toBeCloseTo(2 / 3, 6);
    expect(g.status).toBe("partial");
  });

  it("past day, due but none taken → missed (red)", () => {
    const g = gradeDay([reg()], new Map(), TODAY - 3 * MS_DAY, NOW);
    expect(g.status).toBe("missed");
  });

  it("today, due but none taken → never missed (in progress)", () => {
    const g = gradeDay([reg()], new Map(), TODAY, NOW);
    expect(g.status).toBe("none");
    expect(g.graded).toBe(true);
    expect(g.perMed[0].scheduled).toBe(1); // still scheduled, for dots
  });

  it("today, partial progress grades partial", () => {
    const g = gradeDay([reg({ frequency: twice })], new Map([["m1", [log()]]]), TODAY, NOW);
    expect(g.status).toBe("partial");
  });

  it("future day is not graded; scheduled dots still computed", () => {
    const g = gradeDay([reg()], new Map(), TODAY + 3 * MS_DAY, NOW);
    expect(g.graded).toBe(false);
    expect(g.status).toBe("none");
    expect(g.perMed[0].scheduled).toBe(1);
  });
});

describe("timezone day bucketing", () => {
  it("buckets by local day; midnight boundary splits days", () => {
    expect(dayKey(TODAY + 3_600_000)).toBe(dayKey(TODAY + 23 * 3_600_000));
    expect(dayKey(TODAY - 1)).not.toBe(dayKey(TODAY));
  });
});

describe("buildWheelModel", () => {
  it("centres today and exposes a legend", () => {
    const model = buildWheelModel({
      nowMs: NOW,
      rangeDays: 50,
      regimens: [reg({ medicationId: "a" }), reg({ medicationId: "b" })],
      takenLogs: [log({ medicationId: "a" })],
    });
    expect(model.days).toHaveLength(101);
    expect(model.todayIndex).toBe(50);
    expect(model.days[50].isToday).toBe(true);
    expect(model.legend).toHaveLength(2);
    // Today shows med dots for what's scheduled/logged.
    expect(model.days[50].meds.length).toBeGreaterThan(0);
  });
});

describe("complianceColour ramp", () => {
  it("hits the anchor colours", () => {
    expect(complianceColour(1)).toBe("#34D058"); // green
    expect(complianceColour(0.8)).toBe("#86C99A"); // sage
    expect(complianceColour(0.5)).toBe("#FFD60A"); // yellow
    expect(complianceColour(0)).toBe("#FF3C00"); // red
  });

  it("clamps out-of-range input", () => {
    expect(complianceColour(2)).toBe("#34D058");
    expect(complianceColour(-1)).toBe("#FF3C00");
  });

  it("near-full (5/6) reads as a green, not yellow", () => {
    const c = complianceColour(5 / 6);
    expect(c).not.toBe("#FFD60A");
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    expect(g).toBeGreaterThan(r); // greenish
  });
});

describe("dose-weighted day grade", () => {
  it("a missed 3×/day med costs 3 of 4 units", () => {
    const a = reg({ medicationId: "a", frequency: thrice });
    const b = reg({ medicationId: "b", frequency: daily });
    const past = TODAY - MS_DAY;

    // Take only the 1×/day med → 1 of 4 doses.
    const g1 = gradeDay(
      [a, b],
      new Map([["b", [log({ medicationId: "b" })]]]),
      past,
      NOW
    );
    expect(g1.dueTotal).toBe(4);
    expect(g1.ratio).toBeCloseTo(0.25, 6);

    // Take all 3 of the 3×/day med, miss the 1×/day → 3 of 4 doses.
    const g2 = gradeDay(
      [a, b],
      new Map([
        [
          "a",
          [
            log({ medicationId: "a" }),
            log({ medicationId: "a" }),
            log({ medicationId: "a" }),
          ],
        ],
      ]),
      past,
      NOW
    );
    expect(g2.ratio).toBeCloseTo(0.75, 6);
  });
});
