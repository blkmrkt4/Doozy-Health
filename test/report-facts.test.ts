import { describe, it, expect } from "vitest";
import {
  computeReportFacts,
  computeAdherence,
  type ReportRows,
} from "@/lib/report/report-data";
import type { Frequency } from "@/lib/types";

// Deterministic report-facts layer (PRD §5.10.1, §15). Pure — no DB, no LLM.
// Covers adherence counts + gap detection, diary scope (general vs medication),
// and labs (periodic) bucketing.

const DAY = 86_400_000;
const weekly: Frequency = { type: "every", interval: 1, unit: "week" };

function ms(iso: string): number {
  return new Date(`${iso}T12:00:00`).getTime();
}

describe("computeAdherence", () => {
  it("flags a multi-week gap, not the odd miss", () => {
    // Weekly schedule over ~8 weeks anchored on the from-date; the patient logs
    // weeks 1,2 then misses 3,4,5 (a three-week gap) then logs 6,7,8.
    const from = "2026-04-06"; // a Monday
    const to = "2026-06-01";
    const fromMs = new Date(`${from}T00:00:00`).getTime();
    const toMs = new Date(`${to}T23:59:59`).getTime();
    const anchorMs = fromMs;
    const taken = [0, 1, 5, 6, 7].map((w) => anchorMs + w * 7 * DAY + 2 * 3_600_000);

    const a = computeAdherence(weekly, anchorMs, fromMs, toMs, taken, 0);

    expect(a.scheduledCount).toBeGreaterThanOrEqual(8);
    expect(a.coveredCount).toBe(5);
    expect(a.gaps.length).toBe(1);
    expect(a.gaps[0].missedDoses).toBe(3);
    expect(a.longestGapDays).toBeGreaterThanOrEqual(20);
    expect(a.consistency).toBe("irregular");
  });

  it("reads a single miss as mostly regular, no notable gap", () => {
    const from = "2026-04-06";
    const to = "2026-06-08"; // ~9 weeks
    const fromMs = new Date(`${from}T00:00:00`).getTime();
    const toMs = new Date(`${to}T23:59:59`).getTime();
    const anchorMs = fromMs;
    // Log every week except week 3.
    const weeks = [0, 1, 2, 4, 5, 6, 7, 8];
    const taken = weeks.map((w) => anchorMs + w * 7 * DAY + 3 * 3_600_000);

    const a = computeAdherence(weekly, anchorMs, fromMs, toMs, taken, 0);

    expect(a.gaps.length).toBe(0); // a single miss is not a "gap" (needs ≥2)
    expect(["regular", "mostly regular"]).toContain(a.consistency);
  });

  it("treats as-needed regimens as unscheduled", () => {
    const a = computeAdherence(
      { type: "as_needed" },
      ms("2026-05-01"),
      ms("2026-05-01"),
      ms("2026-06-01"),
      [ms("2026-05-03"), ms("2026-05-20")],
      0
    );
    expect(a.scheduledCount).toBe(0);
    expect(a.consistency).toBe("as needed");
    expect(a.takenCount).toBe(2);
  });
});

describe("computeReportFacts", () => {
  const from = "2026-05-01";
  const to = "2026-05-31";

  function rows(partial: Partial<ReportRows>): ReportRows {
    return {
      patient: { name: "Sloan", date_of_birth: "1990-05-01", sex: "male" },
      medications: [],
      doseLogs: [],
      diaryEntries: [],
      trackedFields: [],
      fieldScope: new Map(),
      ...partial,
    };
  }

  it("computes patient age and period", () => {
    const { facts } = computeReportFacts(rows({}), from, to);
    expect(facts.patient.ageYears).toBe(36);
    expect(facts.patient.sex).toBe("male");
    expect(facts.period.days).toBeGreaterThanOrEqual(29);
  });

  it("scopes a metric to its medication and buckets labs separately", () => {
    const r = rows({
      medications: [
        {
          id: "med-t",
          display_name: "testosterone",
          canonical_drug_id: null,
          colour: null,
          prescribed_regimens: null,
          delivery_forms: null,
          chosen_regimens: [
            {
              dose_amount: "50",
              dose_unit: "mg",
              route: "intramuscular",
              frequency: { type: "times_per", count: 3, period: "week" },
              active: true,
              reason_note: null,
              created_at: `${from}T00:00:00`,
            },
          ],
        },
      ],
      trackedFields: [
        { id: "energy", name: "Energy", field_type: "scale_1_10", unit: null, category_options: null, cadence: "daily" },
        { id: "libido", name: "Libido", field_type: "scale_1_10", unit: null, category_options: null, cadence: "daily" },
        { id: "bp", name: "Blood pressure systolic", field_type: "number", unit: "mmHg", category_options: null, cadence: "periodic" },
      ],
      fieldScope: new Map([["libido", ["med-t"]]]),
      diaryEntries: [
        { entry_at: `${from}T08:00:00`, field_values: { energy: 4, libido: 5, bp: 120 }, note: null },
        { entry_at: `2026-05-15T08:00:00`, field_values: { energy: 6, libido: 7 }, note: null },
        { entry_at: `2026-05-28T08:00:00`, field_values: { energy: 7, libido: 8, bp: 124 }, note: null },
      ],
    });

    const { facts, diarySeries } = computeReportFacts(r, from, to);

    const energy = facts.diaryMetrics.find((d) => d.name === "Energy")!;
    expect(energy.scope).toBe("general");
    expect(energy.numeric?.first).toBe(4);
    expect(energy.numeric?.last).toBe(7);

    const libido = facts.diaryMetrics.find((d) => d.name === "Libido")!;
    expect(libido.scope).toEqual({ medications: ["testosterone"] });

    const bp = facts.diaryMetrics.find((d) => d.name.startsWith("Blood pressure"))!;
    expect(bp.cadence).toBe("periodic");

    // Series carry full-resolution points for the charts.
    const energySeries = diarySeries.find((s) => s.name === "Energy");
    expect(energySeries?.kind).toBe("numeric");

    // Series carry stats + the scale flag for the report's diary-replica view.
    expect(energySeries?.kind === "numeric" && energySeries.scale).toBe(true);
    expect(energySeries?.kind === "numeric" && energySeries.stats.median).toBe(6); // [4,6,7]→6
    expect((bp.numeric as { median: number }).median).toBe(122); // [120,124]→122

    // Weekly timeline aligns numeric means for correlation narration.
    expect(facts.timeline.length).toBeGreaterThan(0);
  });

  it("flags doses logged above the prescribed amount, with unit conversion", () => {
    const r = rows({
      medications: [
        {
          id: "med-x",
          display_name: "methylphenidate",
          canonical_drug_id: null,
          colour: null,
          prescribed_regimens: [
            {
              dose_amount: "10",
              dose_unit: "mg",
              route: "oral",
              frequency: { type: "every", interval: 1, unit: "day" },
              prescriber_name: null,
            },
          ],
          delivery_forms: null,
          chosen_regimens: [
            {
              dose_amount: "10",
              dose_unit: "mg",
              route: "oral",
              frequency: { type: "every", interval: 1, unit: "day" },
              active: true,
              reason_note: null,
              created_at: `${from}T00:00:00`,
            },
          ],
        },
      ],
      doseLogs: [
        // within prescribed
        { medication_id: "med-x", event_type: "taken", logged_at: `${from}T08:00:00`, amount: "10", unit: "mg", route_taken: "oral", site: null, note: null },
        // above prescribed
        { medication_id: "med-x", event_type: "taken", logged_at: `2026-05-10T08:00:00`, amount: "20", unit: "mg", route_taken: "oral", site: null, note: null },
        // above prescribed, different (convertible) unit: 0.05 g = 50 mg
        { medication_id: "med-x", event_type: "taken", logged_at: `2026-05-12T08:00:00`, amount: "0.05", unit: "g", route_taken: "oral", site: null, note: null },
      ],
    });

    const { facts, medOverDose } = computeReportFacts(r, from, to);
    const med = facts.medications[0];
    expect(med.overDose?.count).toBe(2);
    expect(med.overDose?.maxRatio).toBe(5); // 50 mg / 10 mg
    expect(medOverDose.get("med-x")?.count).toBe(2);
  });

  it("marks a tracked substance (alcohol) as a substance", () => {
    const r = rows({
      trackedFields: [
        { id: "alc", name: "Alcohol", field_type: "number", unit: "drinks", category_options: null, cadence: "daily" },
      ],
      diaryEntries: [
        { entry_at: `${from}T20:00:00`, field_values: { alc: 2 }, note: null },
        { entry_at: `2026-05-20T20:00:00`, field_values: { alc: 0 }, note: null },
      ],
    });
    const { facts } = computeReportFacts(r, from, to);
    const alcohol = facts.diaryMetrics.find((d) => d.name === "Alcohol")!;
    expect(alcohol.isSubstance).toBe(true);
    expect(alcohol.substanceName).toBe("alcohol");
  });

  it("separates single-use (OTC) meds into adhocMeds, out of the regimen list", () => {
    const r = rows({
      medications: [
        {
          id: "med-otc",
          display_name: "Tylenol",
          canonical_drug_id: null,
          colour: null,
          single_use: true,
          prescribed_regimens: null,
          delivery_forms: null,
          chosen_regimens: null,
        },
      ],
      doseLogs: [
        { medication_id: "med-otc", event_type: "prn", logged_at: `${from}T09:00:00`, amount: "500", unit: "mg", route_taken: "oral", site: null, note: null },
        { medication_id: "med-otc", event_type: "prn", logged_at: `2026-05-20T09:00:00`, amount: "500", unit: "mg", route_taken: "oral", site: null, note: null },
      ],
    });
    const { facts } = computeReportFacts(r, from, to);
    expect(facts.medications).toHaveLength(0);
    expect(facts.adhocMeds).toHaveLength(1);
    expect(facts.adhocMeds[0].name).toBe("Tylenol");
    expect(facts.adhocMeds[0].doseCount).toBe(2);
  });
});
