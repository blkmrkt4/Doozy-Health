import { describe, it, expect } from "vitest";
import { startOfDay } from "@/lib/schedule";
import { buildWheelModel, type MedRegimen, type TakenLog, type DayLog, type MedLogMeta } from "@/lib/adherence";
import { buildSimpleTodayModel } from "@/lib/simple-today";
import { parseDisplayPrefs } from "@/lib/display-prefs";
import { buildQuickLogFormData, defaultDoseText, noonInput } from "@/lib/quick-log";
import type { Frequency } from "@/lib/types";

const MS_DAY = 24 * 3_600_000;
// Fixed local "now": 2024-01-10, midday — timezone-robust day bucketing.
const NOW = new Date(2024, 0, 10, 12, 0, 0, 0).getTime();
const TODAY = startOfDay(NOW);

const daily: Frequency = { type: "every", interval: 1, unit: "day" };
const weekly: Frequency = { type: "every", interval: 1, unit: "week" };

function meta(over: Partial<MedLogMeta> = {}): MedLogMeta {
  return {
    medId: "m1",
    name: "Alpha",
    colour: "#6AA9FF",
    defaultAmount: 50,
    defaultUnit: "mg",
    defaultRoute: "oral",
    isInjectable: false,
    concentrationAmount: null,
    concentrationPerVolume: null,
    syringeCapacityMl: null,
    ...over,
  };
}

function reg(over: Partial<MedRegimen> = {}): MedRegimen {
  return {
    medicationId: "m1",
    frequency: daily,
    anchorMs: TODAY - 20 * MS_DAY,
    doseAmount: 50,
    doseUnit: "mg",
    colour: "#6AA9FF",
    ...over,
  };
}

function model(opts: {
  regimens: MedRegimen[];
  takenLogs?: TakenLog[];
  medMeta: Record<string, MedLogMeta>;
  dayLogs?: DayLog[];
}) {
  const wheelModel = buildWheelModel({
    nowMs: NOW,
    rangeDays: 5,
    regimens: opts.regimens,
    takenLogs: opts.takenLogs ?? [],
  });
  return buildSimpleTodayModel({
    wheelModel,
    medMeta: opts.medMeta,
    dayLogs: opts.dayLogs ?? [],
  });
}

describe("buildSimpleTodayModel", () => {
  it("puts a scheduled-but-unlogged med in remaining", () => {
    const m = model({ regimens: [reg()], medMeta: { m1: meta() } });
    expect(m.remaining.map((d) => d.medId)).toEqual(["m1"]);
    expect(m.done).toEqual([]);
    expect(m.unscheduled).toEqual([]);
  });

  it("moves a fully logged med to done with its undoable log ids", () => {
    const logs: DayLog[] = [
      { id: "log-1", medId: "m1", loggedAtMs: NOW - 3_600_000, eventType: "taken", amount: 50, unit: "mg" },
    ];
    const m = model({
      regimens: [reg()],
      takenLogs: [{ medicationId: "m1", loggedAtMs: NOW - 3_600_000, amount: 50, unit: "mg" }],
      medMeta: { m1: meta() },
      dayLogs: logs,
    });
    expect(m.remaining).toEqual([]);
    expect(m.done).toHaveLength(1);
    expect(m.done[0].logIds).toEqual(["log-1"]);
  });

  it("puts an off-cadence med in unscheduled", () => {
    // Weekly, anchored 3 days ago → nothing due today.
    const m = model({
      regimens: [reg({ frequency: weekly, anchorMs: TODAY - 3 * MS_DAY })],
      medMeta: { m1: meta() },
    });
    expect(m.remaining).toEqual([]);
    expect(m.unscheduled.map((d) => d.medId)).toEqual(["m1"]);
  });

  it("reports yesterday's factual shortfall only when doses were unlogged", () => {
    const none = model({ regimens: [reg()], medMeta: { m1: meta() } });
    expect(none.yesterday?.shortfalls).toEqual([
      { medId: "m1", scheduled: 1, logged: 0 },
    ]);

    const covered = model({
      regimens: [reg()],
      takenLogs: [
        { medicationId: "m1", loggedAtMs: NOW - MS_DAY, amount: 50, unit: "mg" },
      ],
      medMeta: { m1: meta() },
    });
    expect(covered.yesterday).toBeNull();
  });

  it("sorts groups alphabetically by medication name", () => {
    const m = model({
      regimens: [reg(), reg({ medicationId: "m2", colour: "#fff" })],
      medMeta: {
        m1: meta({ name: "Zeta" }),
        m2: meta({ medId: "m2", name: "Alpha" }),
      },
    });
    expect(m.remaining.map((d) => d.medId)).toEqual(["m2", "m1"]);
  });
});

describe("parseDisplayPrefs", () => {
  it("reads simple_mode: true", () => {
    expect(parseDisplayPrefs({ simple_mode: true }).simpleMode).toBe(true);
  });

  it.each([null, undefined, "x", 4, [], {}, { simple_mode: "true" }, { simple_mode: 1 }])(
    "treats %j as off",
    (raw) => {
      expect(parseDisplayPrefs(raw).simpleMode).toBe(false);
    }
  );
});

describe("quick-log FormData contract", () => {
  it("submits the regimen unit and route for a plain med", () => {
    const fd = buildQuickLogFormData({
      meta: meta(),
      doseText: "50",
      dayMs: TODAY,
      isToday: true,
    })!;
    expect(fd.get("medication_id")).toBe("m1");
    expect(fd.get("amount")).toBe("50");
    expect(fd.get("unit")).toBe("mg");
    expect(fd.get("route_taken")).toBe("oral");
    expect(fd.get("note")).toBeNull();
    expect(fd.get("logged_at")).toBeNull();
  });

  it("converts mL to the regimen unit for syringe-drawn injectables", () => {
    const inj = meta({
      isInjectable: true,
      defaultAmount: 60,
      concentrationAmount: 200, // 200 mg per 1 mL
      concentrationPerVolume: 1,
      syringeCapacityMl: 1,
    });
    expect(defaultDoseText(inj)).toEqual({ doseText: "0.30", unitLabel: "ml" });
    const fd = buildQuickLogFormData({
      meta: inj,
      doseText: "0.30",
      dayMs: TODAY,
      isToday: true,
    })!;
    expect(Number(fd.get("amount"))).toBeCloseTo(60);
    expect(fd.get("unit")).toBe("mg");
    expect(fd.get("note")).toBe("0.30 mL drawn");
  });

  it("back-dates to local noon when logging a past day", () => {
    const fd = buildQuickLogFormData({
      meta: meta(),
      doseText: "50",
      dayMs: TODAY - MS_DAY,
      isToday: false,
    })!;
    expect(fd.get("logged_at")).toBe(noonInput(TODAY - MS_DAY));
    expect(String(fd.get("logged_at"))).toMatch(/^2024-01-09T12:00$/);
  });

  it("rejects a non-positive or non-numeric figure", () => {
    expect(
      buildQuickLogFormData({ meta: meta(), doseText: "0", dayMs: TODAY, isToday: true })
    ).toBeNull();
    expect(
      buildQuickLogFormData({ meta: meta(), doseText: "abc", dayMs: TODAY, isToday: true })
    ).toBeNull();
  });
});
