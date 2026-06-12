import { describe, it, expect } from "vitest";
import {
  containsBannedLanguage,
  validateNarrative,
  buildFallbackNarrative,
} from "@/lib/report/narrative";
import type { ReportFacts } from "@/lib/report/report-data";

// Regulatory filter + deterministic fallback for the clinical summary
// (PRD §5.10.1, §6.1, §15). Pure — no LLM env needed.

describe("containsBannedLanguage", () => {
  it("trips on directive / clinical-advice phrasing", () => {
    expect(containsBannedLanguage("You should increase the dose.")).toBe(true);
    expect(containsBannedLanguage("We recommend testosterone for this.")).toBe(true);
    expect(containsBannedLanguage("This will treat the symptoms.")).toBe(true);
    expect(containsBannedLanguage("Consider titrating upward.")).toBe(true);
    expect(containsBannedLanguage("Diagnosis: hypogonadism.")).toBe(true);
    expect(containsBannedLanguage("Lower their dose next month.")).toBe(true);
  });

  it("allows neutral observational prose", () => {
    expect(
      containsBannedLanguage(
        "The user logged testosterone 3 times per week and recorded energy trending from 4 to 7."
      )
    ).toBe(false);
    expect(
      containsBannedLanguage("Blood pressure was logged twice; values around 120–124 mmHg.")
    ).toBe(false);
  });
});

describe("validateNarrative", () => {
  it("coerces a well-formed object", () => {
    const n = validateNarrative({
      overview: "  A summary.  ",
      medications: [
        { name: "testosterone", summary: "Logged regularly." },
        { name: "", summary: "dropped — no name" },
      ],
      adherence_notes: "Consistent.",
      diary_observations: "Energy up.",
      correlation_observations: "",
      data_caveats: "",
    });
    expect(n).not.toBeNull();
    expect(n!.overview).toBe("A summary.");
    expect(n!.medications).toHaveLength(1);
    expect(n!.generatedByLlm).toBe(true);
  });

  it("rejects an empty object", () => {
    expect(validateNarrative({})).toBeNull();
    expect(validateNarrative({ medications: [] })).toBeNull();
  });
});

const facts: ReportFacts = {
  period: { from: "2026-05-01", to: "2026-05-31", days: 30 },
  patient: { ageYears: 36, sex: "male" },
  medications: [
    {
      name: "testosterone",
      route: "Intramuscular (IM)",
      chosenRegimen: "50 mg · 3× per week · Intramuscular (IM)",
      prescribedRegimen: null,
      reasonNote: "Split to flatten the spike",
      adherence: {
        scheduledCount: 13,
        takenCount: 12,
        skippedCount: 0,
        coveredCount: 12,
        longestGapDays: 4,
        gaps: [],
        consistency: "mostly regular",
      },
    },
    {
      name: "chorionic gonadotropin",
      route: "Intramuscular (IM)",
      chosenRegimen: "100 mg · every week · Intramuscular (IM)",
      prescribedRegimen: null,
      reasonNote: null,
      adherence: {
        scheduledCount: 4,
        takenCount: 1,
        skippedCount: 0,
        coveredCount: 1,
        longestGapDays: 21,
        gaps: [{ startDate: "2026-05-08", endDate: "2026-05-22", missedDoses: 3, days: 21 }],
        consistency: "irregular",
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
};

describe("buildFallbackNarrative", () => {
  it("produces a usable, regulator-safe summary from facts alone", () => {
    const n = buildFallbackNarrative(facts);
    expect(n.generatedByLlm).toBe(false);
    // Names both medications.
    expect(n.medications.map((m) => m.name)).toEqual([
      "testosterone",
      "chorionic gonadotropin",
    ]);
    // Surfaces the multi-week gap on HCG.
    expect(n.adherence_notes.toLowerCase()).toContain("chorionic gonadotropin");
    // Groups labs separately from general measures.
    expect(n.diary_observations).toContain("Labs and measurements");
    expect(n.diary_observations).toContain("General measures");
    // And it never reads as advice.
    expect(
      containsBannedLanguage(
        [n.overview, n.adherence_notes, n.diary_observations, ...n.medications.map((m) => m.summary)].join(" ")
      )
    ).toBe(false);
  });

  it("lists only curated interactions present in the facts, non-directively", () => {
    const withInteractions = {
      ...facts,
      interactions: [
        {
          severity: "caution" as const,
          mechanism: "Both act on the central nervous system; combined use can increase drowsiness.",
          aLabel: "alcohol (tracked in diary)",
          bLabel: "citalopram",
        },
      ],
    };
    const n = buildFallbackNarrative(withInteractions);
    expect(n.interaction_observations).toContain("citalopram");
    expect(n.interaction_observations).toContain("alcohol (tracked in diary)");
    // Framed as something to discuss — never directive (§6.1, rule #9).
    expect(n.interaction_observations.toLowerCase()).toContain("discuss");
    expect(containsBannedLanguage(n.interaction_observations)).toBe(false);
  });

  it("emits no interaction text when the facts hold none", () => {
    expect(buildFallbackNarrative(facts).interaction_observations).toBe("");
  });
});
