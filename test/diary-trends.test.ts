import { describe, it, expect } from "vitest";
import {
  buildTrends,
  type TrendField,
  type TrendEntry,
} from "@/lib/diary-trends";

const fields: TrendField[] = [
  { id: "mood", name: "Mood", field_type: "scale_1_10", unit: null, category_options: null },
  { id: "sleep", name: "Sleep", field_type: "number", unit: "hours", category_options: null },
  { id: "exercised", name: "Exercised", field_type: "boolean", unit: null, category_options: null },
  { id: "tol", name: "Tolerance", field_type: "category", unit: null, category_options: ["Poor", "Good"] },
  { id: "sx", name: "Side effects", field_type: "multiselect", unit: null, category_options: ["Nausea", "Headache"] },
  { id: "bp", name: "BP", field_type: "freetext", unit: null, category_options: null },
];

function trendFor(id: string, entries: TrendEntry[]) {
  return buildTrends(fields, entries).find((t) => t.field.id === id)!.trend;
}

describe("buildTrends", () => {
  it("summarizes numeric fields with range, latest, average and median", () => {
    const entries: TrendEntry[] = [
      { date: "2026-06-01", field_values: { mood: 3 } },
      { date: "2026-06-02", field_values: { mood: 9 } },
      { date: "2026-06-03", field_values: { mood: 6 } },
    ];
    const t = trendFor("mood", entries);
    expect(t.kind).toBe("numeric");
    if (t.kind !== "numeric") return;
    expect(t.min).toBe(3);
    expect(t.max).toBe(9);
    expect(t.latest).toBe(6);
    expect(t.avg).toBe(6);
    expect(t.median).toBe(6); // sorted [3,6,9] → middle 6
    expect(t.points.map((p) => p.value)).toEqual([3, 9, 6]);
  });

  it("computes median as the mean of the two middle values when even", () => {
    const entries: TrendEntry[] = [
      { date: "2026-06-01", field_values: { mood: 2 } },
      { date: "2026-06-02", field_values: { mood: 4 } },
      { date: "2026-06-03", field_values: { mood: 6 } },
      { date: "2026-06-04", field_values: { mood: 10 } },
    ];
    const t = trendFor("mood", entries);
    if (t.kind !== "numeric") throw new Error("expected numeric");
    expect(t.median).toBe(5); // sorted [2,4,6,10] → (4+6)/2
  });

  it("orders points oldest-first regardless of input order", () => {
    const entries: TrendEntry[] = [
      { date: "2026-06-03", field_values: { sleep: 7 } },
      { date: "2026-06-01", field_values: { sleep: 5 } },
    ];
    const t = trendFor("sleep", entries);
    if (t.kind !== "numeric") throw new Error("expected numeric");
    expect(t.points[0].date).toBe("2026-06-01");
    expect(t.points[1].date).toBe("2026-06-03");
  });

  it("keeps the latest value when a day is logged more than once", () => {
    const entries: TrendEntry[] = [
      { date: "2026-06-01", field_values: { mood: 4 } },
      { date: "2026-06-01", field_values: { mood: 8 } },
    ];
    const t = trendFor("mood", entries);
    if (t.kind !== "numeric") throw new Error("expected numeric");
    expect(t.count).toBe(1);
    expect(t.latest).toBe(8);
  });

  it("treats a cleared value as removing that day", () => {
    const entries: TrendEntry[] = [
      { date: "2026-06-01", field_values: { mood: 5 } },
      { date: "2026-06-01", field_values: { mood: null } },
    ];
    expect(trendFor("mood", entries).kind).toBe("empty");
  });

  it("counts yes/no for boolean fields", () => {
    const entries: TrendEntry[] = [
      { date: "2026-06-01", field_values: { exercised: true } },
      { date: "2026-06-02", field_values: { exercised: false } },
      { date: "2026-06-03", field_values: { exercised: true } },
    ];
    const t = trendFor("exercised", entries);
    if (t.kind !== "boolean") throw new Error("expected boolean");
    expect(t.yes).toBe(2);
    expect(t.total).toBe(3);
  });

  it("builds a sorted distribution for category and multiselect", () => {
    const entries: TrendEntry[] = [
      { date: "2026-06-01", field_values: { tol: "Good", sx: ["Nausea"] } },
      { date: "2026-06-02", field_values: { tol: "Good", sx: ["Nausea", "Headache"] } },
      { date: "2026-06-03", field_values: { tol: "Poor" } },
    ];
    const cat = trendFor("tol", entries);
    if (cat.kind !== "distribution") throw new Error("expected distribution");
    expect(cat.counts[0]).toEqual({ option: "Good", count: 2 });
    expect(cat.total).toBe(3);

    const multi = trendFor("sx", entries);
    if (multi.kind !== "distribution") throw new Error("expected distribution");
    expect(multi.counts.find((c) => c.option === "Nausea")?.count).toBe(2);
    expect(multi.total).toBe(2);
  });

  it("returns recent text for freetext fields, newest first", () => {
    const entries: TrendEntry[] = [
      { date: "2026-06-01", field_values: { bp: "120/80" } },
      { date: "2026-06-02", field_values: { bp: "118/79" } },
    ];
    const t = trendFor("bp", entries);
    if (t.kind !== "text") throw new Error("expected text");
    expect(t.recent[0]).toEqual({ date: "2026-06-02", text: "118/79" });
  });

  it("returns empty for a field with no logged values", () => {
    expect(trendFor("mood", []).kind).toBe("empty");
  });
});
