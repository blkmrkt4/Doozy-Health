import { describe, it, expect } from "vitest";
import { renderReportText, readableDate } from "@/lib/report/text-report";
import type { ReportData } from "@/lib/report/report-data";
import type { ClinicalNarrative } from "@/lib/report/narrative";

// Plain-text report serializer (PRD §5.10). Pure — no DB.

describe("readableDate", () => {
  it("renders a full, ordinal, weekday date", () => {
    expect(readableDate("2026-05-13")).toBe("Wednesday, May 13th, 2026");
    expect(readableDate("2026-06-12")).toBe("Friday, June 12th, 2026");
    expect(readableDate("2026-06-01")).toBe("Monday, June 1st, 2026");
  });
});

const data = {
  rows: {
    medications: [{ id: "med-t", display_name: "testosterone" }],
    doseLogs: [],
  },
  facts: {
    period: { from: "2026-05-13", to: "2026-06-12", days: 30 },
    patient: { ageYears: 36, sex: "male" },
    medications: [
      {
        name: "testosterone",
        route: "Intramuscular (IM)",
        chosenRegimen: "50 mg · 3× per week · Intramuscular (IM)",
        prescribedRegimen: null,
        reasonNote: null,
        adherence: {
          scheduledCount: 13,
          takenCount: 12,
          skippedCount: 0,
          coveredCount: 12,
          longestGapDays: null,
          gaps: [],
          consistency: "mostly regular",
        },
      },
    ],
    diaryMetrics: [
      {
        name: "Energy",
        scope: "general",
        cadence: "daily",
        fieldType: "scale_1_10",
        unit: null,
        entries: 10,
        numeric: { min: 4, max: 8, mean: 6.1, median: 6, first: 4, last: 7 },
      },
      {
        name: "Blood pressure systolic",
        scope: "general",
        cadence: "periodic",
        fieldType: "number",
        unit: "mmHg",
        entries: 2,
        numeric: { min: 120, max: 124, mean: 122, median: 122, first: 120, last: 124 },
      },
    ],
    timeline: [],
    interactions: [],
  },
} as unknown as ReportData;

const narrative: ClinicalNarrative = {
  overview: "A 36-year-old male logged 1 medication over 30 days.",
  medications: [{ name: "testosterone", summary: "Logged consistently." }],
  adherence_notes: "Consistent dosing.",
  diary_observations: "Energy trended up.",
  correlation_observations: "",
  interaction_observations: "",
  data_caveats: "",
  generatedByLlm: true,
};

describe("renderReportText", () => {
  it("includes summary, medication, dosing line, and grouped measures", () => {
    const text = renderReportText({
      patientName: "Sloan",
      generatedDate: "2026-06-12",
      data,
      narrative,
      showFullLog: false,
    });
    expect(text).toContain("WELLKEPT — MEDICATION REPORT");
    expect(text).toContain("Wednesday, May 13th, 2026 to Friday, June 12th, 2026");
    expect(text).toContain("A 36-year-old male");
    expect(text).toContain("Taking: 50 mg · 3× per week · Intramuscular (IM)");
    expect(text).toContain("Logged: 12 of 13 scheduled doses");
    expect(text).toContain("General");
    expect(text).toContain("Labs & measurements");
    expect(text).toContain("Blood pressure systolic");
    // Disclaimer appears (top + bottom).
    expect(text.match(/not a medical device/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("notes the absence of a summary when none was generated", () => {
    const text = renderReportText({
      patientName: "Sloan",
      generatedDate: "2026-06-12",
      data,
      narrative: null,
      showFullLog: false,
    });
    expect(text).toContain("No written summary has been generated");
  });
});
