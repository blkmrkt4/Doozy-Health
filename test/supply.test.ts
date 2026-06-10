import { describe, it, expect } from "vitest";
import {
  dosesPerDay,
  packageUnitsPerDose,
  consumedFromLogs,
  projectRunOut,
  formatRunOut,
} from "@/lib/supply";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000; // fixed instant for deterministic dates

describe("dosesPerDay", () => {
  it("handles every-N-unit", () => {
    expect(dosesPerDay({ type: "every", interval: 1, unit: "day" })).toBe(1);
    expect(dosesPerDay({ type: "every", interval: 8, unit: "hour" })).toBe(3);
    expect(dosesPerDay({ type: "every", interval: 1, unit: "week" })).toBeCloseTo(1 / 7);
    expect(dosesPerDay({ type: "every", interval: 2, unit: "day" })).toBe(0.5);
  });
  it("handles times-per and as-needed", () => {
    expect(dosesPerDay({ type: "times_per", count: 2, period: "day" })).toBe(2);
    expect(dosesPerDay({ type: "times_per", count: 3, period: "week" })).toBeCloseTo(3 / 7);
    expect(dosesPerDay({ type: "as_needed" })).toBeNull();
  });
});

describe("packageUnitsPerDose", () => {
  it("is 1:1 when the dose is already in package units", () => {
    expect(packageUnitsPerDose(1, "tablet", "tablets", null)).toBe(1);
    expect(packageUnitsPerDose(2, "mL", "mL", null)).toBe(2);
  });
  it("converts a mass dose via the tablet strength", () => {
    // 20 mg dose, 20 mg per 1 tablet → 1 tablet
    const conc = { amount: 20, unit: "mg", per_volume: 1, volume_unit: "tablet" };
    expect(packageUnitsPerDose(20, "mg", "tablets", conc)).toBe(1);
    expect(packageUnitsPerDose(40, "mg", "tablets", conc)).toBe(2);
  });
  it("converts a mass dose via the liquid concentration", () => {
    // 50 mg dose, 200 mg per 1 mL → 0.25 mL
    const conc = { amount: 200, unit: "mg", per_volume: 1, volume_unit: "mL" };
    expect(packageUnitsPerDose(50, "mg", "mL", conc)).toBeCloseTo(0.25);
  });
  it("returns null when units can't be reconciled", () => {
    expect(packageUnitsPerDose(20, "mg", "tablets", null)).toBeNull();
    expect(packageUnitsPerDose(20, "mcg", "tablets", { amount: 20, unit: "mg", per_volume: 1, volume_unit: "tablet" })).toBeNull();
  });
});

describe("projectRunOut", () => {
  it("projects a run-out date for 90 tablets at 1/day", () => {
    const r = projectRunOut({
      packageCount: 90,
      packageUnit: "tablets",
      concentration: { amount: 20, unit: "mg", per_volume: 1, volume_unit: "tablet" },
      regimen: { doseAmount: 20, doseUnit: "mg", frequency: { type: "every", interval: 1, unit: "day" } },
      consumed: 0,
      now: NOW,
    })!;
    expect(r.remaining).toBe(90);
    expect(r.unitsPerDay).toBe(1);
    expect(r.daysLeft).toBe(90);
    expect(r.runOutAt!.getTime()).toBe(NOW + 90 * DAY);
  });

  it("moves the date out when under-dosing (fewer logged than scheduled)", () => {
    // 30 tablets consumed of 90 → 60 left → 60 more days at 1/day.
    const r = projectRunOut({
      packageCount: 90,
      packageUnit: "tablets",
      concentration: null,
      regimen: { doseAmount: 1, doseUnit: "tablet", frequency: { type: "every", interval: 1, unit: "day" } },
      consumed: 30,
      now: NOW,
    })!;
    expect(r.remaining).toBe(60);
    expect(r.daysLeft).toBe(60);
  });

  it("reports ran-out and clamps remaining at zero", () => {
    const r = projectRunOut({
      packageCount: 30,
      packageUnit: "tablets",
      concentration: null,
      regimen: { doseAmount: 1, doseUnit: "tablet", frequency: { type: "every", interval: 1, unit: "day" } },
      consumed: 35,
      now: NOW,
    })!;
    expect(r.ranOut).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it("still gives a count (no date) for as-needed", () => {
    const r = projectRunOut({
      packageCount: 30,
      packageUnit: "tablets",
      concentration: null,
      regimen: { doseAmount: 1, doseUnit: "tablet", frequency: { type: "as_needed" } },
      consumed: 5,
      now: NOW,
    })!;
    expect(r.remaining).toBe(25);
    expect(r.runOutAt).toBeNull();
  });

  it("returns null with no package count", () => {
    expect(
      projectRunOut({ packageCount: 0, packageUnit: "tablets", concentration: null, regimen: null, consumed: 0, now: NOW })
    ).toBeNull();
  });
});

describe("consumedFromLogs + formatRunOut", () => {
  it("sums logged consumption in package units", () => {
    const logs = [
      { amount: 1, unit: "tablet" },
      { amount: 2, unit: "tablet" },
      { amount: null },
    ];
    expect(consumedFromLogs(logs, "tablet", "tablets", null)).toBe(3);
  });

  it("formats a neutral, non-directive line", () => {
    const r = projectRunOut({
      packageCount: 90,
      packageUnit: "tablets",
      concentration: null,
      regimen: { doseAmount: 1, doseUnit: "tablet", frequency: { type: "every", interval: 1, unit: "day" } },
      consumed: 26,
      now: NOW,
    })!;
    const line = formatRunOut(r, NOW);
    expect(line).toContain("64 tablets left");
    expect(line).toContain("runs out around");
    expect(line).not.toMatch(/refill now|urgent|!/i);
  });
});
