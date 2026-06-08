import { describe, it, expect } from "vitest";
import { doseToVolumeMl, formatVolumeMl } from "@/lib/units";
import {
  parseVialExtraction,
  parsePrescriptionExtraction,
} from "@/lib/extraction";

// Reconstituted medications (PRD §5.2): a powder vial's strength is set by the
// volume of diluent the user adds (from their prescription). The concentration
// model is amount = active in the vial, per_volume = mix volume, so all the
// existing dose→volume math applies unchanged.

describe("reconstitution concentration math", () => {
  it("hCG: 5000 IU powder reconstituted with 3 mL → 1666.7 IU/mL", () => {
    const active = 5000;
    const mixVolume = 3;
    const concentrationPerMl = active / mixVolume; // amount / per_volume
    expect(concentrationPerMl).toBeCloseTo(1666.67, 1);

    // A 500 IU dose draws ~0.3 mL at that concentration.
    const mL = doseToVolumeMl(500, active, mixVolume);
    expect(mL).toBeCloseTo(0.3, 2);
    expect(formatVolumeMl(mL, 1)).toBe("0.30 mL");
  });

  it("changing the mix volume rescales the draw volume", () => {
    // Same 5000 IU active; 5 mL diluent → lower concentration → larger draw.
    const mL3 = doseToVolumeMl(500, 5000, 3);
    const mL5 = doseToVolumeMl(500, 5000, 5);
    expect(mL5).toBeGreaterThan(mL3);
    expect(mL5).toBeCloseTo(0.5, 2);
  });
});

describe("reconstitution extraction parsing", () => {
  it("parses a powder vial: requires_reconstitution + active amount, null per-volume", () => {
    const raw = JSON.stringify({
      drug_name_raw: { value: "Chorionic gonadotropin", confidence: "high" },
      drug_name_canonical: { value: "chorionic gonadotropin", confidence: "high" },
      strength: { value: "5000 IU", confidence: "high" },
      requires_reconstitution: { value: "yes", confidence: "high" },
      concentration_amount: { value: 5000, confidence: "high" },
      concentration_unit: { value: "IU", confidence: "high" },
      concentration_per_volume: { value: null, confidence: "low" },
      volume_ml: { value: null, confidence: "low" },
      diluent_type: { value: "bacteriostatic water", confidence: "medium" },
      reconstitution_note: { value: "Reconstitute before use", confidence: "medium" },
      route: { value: "subcutaneous", confidence: "high" },
      directions: { value: "", confidence: "low" },
      expiry_date: { value: "", confidence: "low" },
      batch: { value: "", confidence: "low" },
      manufacturer: { value: "", confidence: "low" },
    });
    const v = parseVialExtraction(raw);
    expect(v).not.toBeNull();
    expect(v!.requires_reconstitution.value).toBe("yes");
    expect(v!.concentration_amount.value).toBe(5000);
    // per-volume is unset until mixed; the parser maps a JSON null to 0 (falsy),
    // and the review form treats 0 as "enter your prescription's mix volume".
    expect(v!.concentration_per_volume.value).toBeFalsy();
    expect(v!.diluent_type.value).toBe("bacteriostatic water");
  });

  it("parses the prescription's mix volume", () => {
    const raw = JSON.stringify({
      drug_name: { value: "hCG", confidence: "high" },
      dose_amount: { value: 500, confidence: "high" },
      dose_unit: { value: "IU", confidence: "high" },
      frequency: { value: "3 times per week", confidence: "high" },
      duration_days: { value: null, confidence: "low" },
      route: { value: "subcutaneous", confidence: "high" },
      prescriber: { value: "Dr. Lee", confidence: "medium" },
      refills: { value: 2, confidence: "medium" },
      diluent_volume_ml: { value: 3, confidence: "high" },
      diluent_type: { value: "bacteriostatic water", confidence: "high" },
      reconstitution_note: {
        value: "Reconstitute with 3 mL bacteriostatic water",
        confidence: "high",
      },
    });
    const rx = parsePrescriptionExtraction(raw);
    expect(rx).not.toBeNull();
    expect(rx!.diluent_volume_ml.value).toBe(3);
    expect(rx!.diluent_type.value).toBe("bacteriostatic water");
  });

  it("parses required_components (array, mixed inferred); tolerates absence", () => {
    const withComps = parseVialExtraction(
      JSON.stringify({
        drug_name_raw: { value: "Ventolin", confidence: "high" },
        required_components: [
          { type: "spacer", inferred: true, confidence: "medium" },
          { type: "face_mask", inferred: false, confidence: "high" },
          { junk: true }, // garbage entry → skipped
        ],
      })
    );
    expect(withComps!.required_components.map((c) => c.type)).toEqual([
      "spacer",
      "face_mask",
    ]);
    expect(withComps!.required_components[0].inferred).toBe(true);

    // Old extractions (no key) parse to an empty array, never throw.
    const without = parseVialExtraction(
      JSON.stringify({ drug_name_raw: { value: "Aspirin", confidence: "high" } })
    );
    expect(without!.required_components).toEqual([]);
  });
});
