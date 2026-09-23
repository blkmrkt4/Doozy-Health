import { describe, expect, it } from "vitest";
import { describePlan, parsePlanFrequency, readRegimenInput, readableTime, weeklyTotal, regimenInputIssue } from "@/lib/regimen-plan";
import { isFrequency, type WeeklyFrequency } from "@/lib/types";
import { occurrencesInWindow, frequencyIntervalMs } from "@/lib/schedule";
import { generateScheduledDoses } from "@/lib/pharmacokinetics";
import { dosesPerDay } from "@/lib/supply";
import { formatFrequency } from "@/lib/format";
import { steadyStateForDrug } from "@/lib/pk/amountInSystem";

const weekly: WeeklyFrequency = { type: "weekly", days: [1, 3, 5], time: "07:00", time_zone: "America/Toronto" };
const iso = (out: number[]) => out.map((ms) => new Date(ms).toISOString());
function form(days = [1, 3, 5], total = "170") {
  const fd = new FormData();
  for (const [key, value] of Object.entries({ chosen_freq_type: "weekly", chosen_freq_time: "07:00", chosen_freq_time_zone: "America/Toronto", chosen_amount_basis: "weekly_total", chosen_weekly_total: total, chosen_dose_amount: "999", chosen_dose_unit: "mg", chosen_route: "intramuscular" })) fd.set(key, value);
  days.forEach((d) => fd.append("chosen_freq_days", String(d)));
  return fd;
}

describe("chosen weekly totals", () => {
  it.each([[1, 3, 5], [1, 4], [1, 2, 3, 4, 5, 6, 7]])("keeps the total and recalculates a split from the selected days %j", (...days) => {
    const result = readRegimenInput(form(days), "chosen")!;
    expect(result.dose_amount).toBe(170 / days.length);
    expect(result.frequency).toMatchObject({ weekly_total: 170 });
    expect(weeklyTotal(result)).toBe(170);
  });
  it("reads either an amount per dose or a weekly total", () => {
    const fd = form([1, 4]); fd.set("chosen_amount_basis", "per_dose"); fd.set("chosen_dose_amount", "85");
    expect(weeklyTotal(readRegimenInput(fd, "chosen")!)).toBe(170);
    expect(readRegimenInput(fd, "chosen")!.frequency).not.toHaveProperty("weekly_total");
  });
  it("rounds the readback but never the saved dose calculation", () => {
    const plan = readRegimenInput(form(), "chosen")!;
    expect(describePlan(plan, "Testosterone")).toContain("170 mg of Testosterone by injection into a muscle each week, divided into 3 equal doses");
    expect(describePlan(plan, "Testosterone")).toContain("approximately 56.67 mg on Monday, Wednesday, and Friday at 7 am in the morning");
    expect(plan.dose_amount).not.toBe(56.67);
  });
  it.each([[], [1, 1], [0], [8]])("rejects missing, duplicate, or invalid weekdays %j", (...days) => {
    expect(readRegimenInput(form(days), "chosen")).toBeNull();
  });
  it.each(["0", "-1", "Infinity", "NaN", ""])("rejects invalid totals %s", (total) => {
    expect(readRegimenInput(form([1], total), "chosen")).toBeNull();
  });
  it("validates local time, time zone, units, and route on the server", () => {
    for (const [key, bad] of [["chosen_freq_time", "24:00"], ["chosen_freq_time_zone", "Invalid/Zone"], ["chosen_dose_unit", "garbage"], ["chosen_route", "garbage"]]) {
      const fd = form(); fd.set(key, bad); expect(readRegimenInput(fd, "chosen")).toBeNull();
    }
  });
  it("retains the existing interval and as-needed shapes", () => {
    const fd = new FormData(); fd.set("f_type", "every"); fd.set("f_interval", "2"); fd.set("f_unit", "day");
    expect(parsePlanFrequency(fd, "f")).toEqual({ type: "every", interval: 2, unit: "day" });
    fd.set("f_interval", "Infinity"); expect(parsePlanFrequency(fd, "f")).toBeNull();
    fd.set("f_type", "as_needed"); expect(parsePlanFrequency(fd, "f")).toEqual({ type: "as_needed" });
  });
  it("accepts stored weekly JSON, including a retained total", () => {
    expect(isFrequency({ ...weekly, weekly_total: 170 })).toBe(true);
    expect(isFrequency({ ...weekly, weekly_total: Infinity })).toBe(false);
    expect(formatFrequency(weekly)).toContain("Monday, Wednesday, and Friday");
  });
  it("spells out noon, midnight, and the part of the day", () => {
    expect(readableTime("00:00")).toBe("midnight"); expect(readableTime("12:00")).toBe("noon");
    expect(readableTime("12:01")).toBe("12:01 pm in the afternoon");
    expect(readableTime("19:30")).toBe("7:30 pm in the evening");
  });
});

describe("calendar weekdays", () => {
  it("uses Monday/Wednesday/Friday, including the longer weekend gap", () => {
    const start = Date.parse("2026-09-21T00:00:00Z"); const end = Date.parse("2026-09-29T00:00:00Z");
    expect(iso(occurrencesInWindow(weekly, start, start, end))).toEqual([
      "2026-09-21T11:00:00.000Z", "2026-09-23T11:00:00.000Z", "2026-09-25T11:00:00.000Z", "2026-09-28T11:00:00.000Z",
    ]);
    expect(frequencyIntervalMs(weekly)).toBeNull();
    expect(dosesPerDay(weekly)).toBe(3 / 7);
    expect(generateScheduledDoses(weekly, 170 / 3, start, end).map((d) => d.timestamp)).toEqual(occurrencesInWindow(weekly, start, start, end));
  });
  it("includes the start, excludes the end, and works in fractional-offset zones", () => {
    const f = { ...weekly, time_zone: "Asia/Kathmandu" };
    const start = Date.parse("2026-09-21T01:15:00Z"); const end = Date.parse("2026-09-23T01:15:00Z");
    expect(iso(occurrencesInWindow(f, 0, start, end))).toEqual(["2026-09-21T01:15:00.000Z"]);
  });
  it("keeps 7 am local across spring daylight saving", () => {
    const f = { ...weekly, days: [6, 7, 1] };
    expect(iso(occurrencesInWindow(f, 0, Date.parse("2026-03-07T00:00Z"), Date.parse("2026-03-10T00:00Z")))).toEqual([
      "2026-03-07T12:00:00.000Z", "2026-03-08T11:00:00.000Z", "2026-03-09T11:00:00.000Z",
    ]);
  });
  it("moves a nonexistent spring time forward and emits a repeated fall time once", () => {
    expect(iso(occurrencesInWindow({ ...weekly, days: [7], time: "02:30" }, 0, Date.parse("2026-03-08T00:00Z"), Date.parse("2026-03-09T00:00Z")))).toEqual(["2026-03-08T07:30:00.000Z"]);
    expect(iso(occurrencesInWindow({ ...weekly, days: [7], time: "01:30" }, 0, Date.parse("2026-11-01T00:00Z"), Date.parse("2026-11-02T00:00Z")))).toEqual(["2026-11-01T05:30:00.000Z"]);
  });
  it("does not flatten the weekly pattern in the PK reference band", () => {
    const drug = { name: "Example", route: "oral" as const, unit: "mg", halfLifeDays: 1, isLinear: true };
    const even = steadyStateForDrug(drug, { perDose: 10, intervalDays: 7 / 3 });
    const named = steadyStateForDrug(drug, { perDose: 10, intervalDays: 7 / 3, weeklyOffsets: [0, 2, 4] });
    expect(named.trough).toBeLessThan(even.trough);
    expect(named.peak).toBeGreaterThan(even.peak);
  });
});

describe("calendar and report integration", () => {
  it("keeps a late-night Monday on Monday in its saved time zone", async () => {
    const { buildWheelModel } = await import("@/lib/adherence");
    const model = buildWheelModel({
      nowMs: Date.parse("2026-09-22T03:30:00Z"), rangeDays: 2,
      regimens: [{ medicationId: "m", frequency: { ...weekly, time: "23:00" }, anchorMs: 0, doseAmount: 170 / 3, doseUnit: "mg", colour: "" }],
      takenLogs: [{ medicationId: "m", loggedAtMs: Date.parse("2026-09-22T03:00:00Z"), amount: 170 / 3, unit: "mg" }],
    });
    const monday = model.days.find(d => d.key === "2026-09-21")!;
    expect(monday.isToday).toBe(true); expect(monday.meds[0].scheduled).toBe(1);
    expect(monday.meds[0].logged).toBe(1); expect(monday.status).toBe("full");
    expect(model.days.find(d => d.key === "2026-09-22")!.meds).toHaveLength(0);
  });
  it("counts exactly the chosen days in a report", async () => {
    const { computeAdherence } = await import("@/lib/report/report-data");
    const start = Date.parse("2026-09-21T00:00:00Z"); const end = Date.parse("2026-09-28T00:00:00Z");
    const scheduled = occurrencesInWindow(weekly, start, start, end);
    const report = computeAdherence(weekly, start, start, end, scheduled, 0);
    expect(report.scheduledCount).toBe(3); expect(report.coveredCount).toBe(3);
  });
});


describe("weekly plans with no set time", () => {
  it("requires either a chosen time or an explicit N/A choice", () => {
    const fd = form([1, 4, 6], "180");
    fd.set("chosen_freq_time", "");
    expect(readRegimenInput(fd, "chosen")).toBeNull();
    expect(regimenInputIssue(fd, "chosen")).toContain("N/A");
    fd.set("chosen_freq_time_unspecified", "on");
    const plan = readRegimenInput(fd, "chosen")!;
    expect(plan.dose_amount).toBe(60);
    expect(plan.frequency).toMatchObject({ days: [1, 4, 6], time: null, weekly_total: 180 });
    expect(regimenInputIssue(fd, "chosen")).toBeNull();
    expect(describePlan(plan, "Example medication")).toContain("60 mg on Monday, Thursday, and Saturday, with no set time of day");
    expect(isFrequency(JSON.parse(JSON.stringify(plan.frequency)))).toBe(true);
  });
  it("retains calendar dates without inventing timed PK doses", () => {
    const frequency = { ...weekly, time: null };
    const start = Date.parse("2026-09-21T00:00:00Z"), end = Date.parse("2026-09-28T00:00:00Z");
    expect(occurrencesInWindow(frequency, start, start, end)).toHaveLength(3);
    expect(generateScheduledDoses(frequency, 60, start, end)).toEqual([]);
  });
  it("matches untimed logs anywhere on the selected local day, never the following day", async () => {
    const { computeAdherence } = await import("@/lib/report/report-data");
    const frequency = { ...weekly, time: null, days: [1] };
    const start = Date.parse("2026-09-21T04:00:00Z"), end = Date.parse("2026-09-28T04:00:00Z");
    expect(computeAdherence(frequency, start, start, end, [Date.parse("2026-09-22T03:59:00Z")], 0).coveredCount).toBe(1);
    expect(computeAdherence(frequency, start, start, end, [Date.parse("2026-09-22T04:01:00Z")], 0).coveredCount).toBe(0);
  });
});
