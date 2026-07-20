import { describe, it, expect } from "vitest";
import { startOfDay } from "@/lib/schedule";
import type { MedLogMeta } from "@/lib/adherence";
import { parseDisplayPrefs } from "@/lib/display-prefs";
import { buildQuickLogFormData, defaultDoseText, noonInput } from "@/lib/quick-log";

const MS_DAY = 24 * 3_600_000;
// Fixed local "now": 2024-01-10, midday — timezone-robust day bucketing.
const NOW = new Date(2024, 0, 10, 12, 0, 0, 0).getTime();
const TODAY = startOfDay(NOW);

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
