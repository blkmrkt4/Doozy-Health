import { describe, it, expect } from "vitest";
import {
  buildSetupChecklist,
  setupComplete,
  accessoriesFromRequiredComponents,
  mergeAccessories,
  type SetupItem,
} from "@/lib/medication-setup";

const get = (items: SetupItem[], key: string) => items.find((i) => i.key === key);

const freq = { type: "times_per", count: 3, period: "week" };

describe("buildSetupChecklist", () => {
  it("injectable vial requires a syringe; satisfied by a resolved capacity", () => {
    const base = {
      delivery: {
        form_type: "vial",
        concentration: { amount: 200 },
        reconstitution: null,
      },
      prescribed: { dose_amount: 1, dose_unit: "mL", route: "intramuscular", frequency: freq },
      chosen: { dose_amount: 1, dose_unit: "mL", route: "intramuscular", frequency: freq },
      hasPrescriptionDoc: false,
    };
    const none = buildSetupChecklist({ ...base, resolvedSyringeCapacityMl: null });
    expect(get(none, "syringe")?.tier).toBe("conditional");
    expect(get(none, "syringe")?.satisfied).toBe(false);
    expect(get(none, "label")?.satisfied).toBe(true); // concentration known
    expect(get(none, "prescription")?.satisfied).toBe(true); // dose+unit+freq

    const withSyringe = buildSetupChecklist({ ...base, resolvedSyringeCapacityMl: 1 });
    expect(get(withSyringe, "syringe")?.satisfied).toBe(true);
    expect(setupComplete(withSyringe)).toBe(true);
  });

  it("a subcutaneous route requires a syringe even without a vial form", () => {
    const items = buildSetupChecklist({
      delivery: { form_type: "pill_bottle", concentration: { amount: 0 }, reconstitution: null },
      prescribed: { dose_amount: 500, dose_unit: "IU", route: "subcutaneous", frequency: freq },
      chosen: null,
      resolvedSyringeCapacityMl: null,
      hasPrescriptionDoc: false,
    });
    expect(get(items, "syringe")).toBeTruthy();
  });

  it("a powder requires its diluent mix volume", () => {
    const powder = (diluentVol: number | null) =>
      buildSetupChecklist({
        delivery: {
          form_type: "vial",
          concentration: { amount: 5000 },
          reconstitution: { requires_reconstitution: true, diluent_volume_ml: diluentVol },
        },
        prescribed: { dose_amount: 500, dose_unit: "IU", route: "subcutaneous", frequency: freq },
        chosen: null,
        resolvedSyringeCapacityMl: 1,
        hasPrescriptionDoc: false,
      });
    expect(get(powder(null), "diluent")?.satisfied).toBe(false);
    expect(get(powder(3), "diluent")?.satisfied).toBe(true);
  });

  it("an oral tablet needs nothing extra — only the two must items", () => {
    const items = buildSetupChecklist({
      delivery: { form_type: "tablet", concentration: { amount: 10 }, reconstitution: null },
      prescribed: { dose_amount: 1, dose_unit: "tablet", route: "oral", frequency: freq },
      chosen: { dose_amount: 1, dose_unit: "tablet", route: "oral", frequency: freq },
      resolvedSyringeCapacityMl: null,
      hasPrescriptionDoc: false,
    });
    expect(items.map((i) => i.key).sort()).toEqual(["label", "prescription"]);
    expect(setupComplete(items)).toBe(true);
  });

  it("a linked prescription photo satisfies the prescription item without a regimen", () => {
    const items = buildSetupChecklist({
      delivery: { form_type: "vial", concentration: { amount: 200 }, reconstitution: null },
      prescribed: { dose_amount: 0, dose_unit: "", route: "intramuscular", frequency: null },
      chosen: null,
      resolvedSyringeCapacityMl: 1,
      hasPrescriptionDoc: true,
    });
    expect(get(items, "prescription")?.satisfied).toBe(true);
  });

  it("an invalid dose unit leaves the prescription item unsatisfied (units are mandatory)", () => {
    const items = buildSetupChecklist({
      delivery: { form_type: "vial", concentration: { amount: 200 }, reconstitution: null },
      prescribed: { dose_amount: 1, dose_unit: "squirts", route: "intramuscular", frequency: freq },
      chosen: null,
      resolvedSyringeCapacityMl: 1,
      hasPrescriptionDoc: false,
    });
    expect(get(items, "prescription")?.satisfied).toBe(false);
  });

  it("awareness accessories never block completion", () => {
    const items = buildSetupChecklist({
      delivery: { form_type: "inhaler", concentration: { amount: 100 }, reconstitution: null },
      prescribed: { dose_amount: 2, dose_unit: "puff", route: "inhaled", frequency: freq },
      chosen: { dose_amount: 2, dose_unit: "puff", route: "inhaled", frequency: freq },
      resolvedSyringeCapacityMl: null,
      hasPrescriptionDoc: false,
      accessories: [{ type: "spacer", label: "Spacer", source: "inferred", acknowledged: false }],
    });
    expect(get(items, "accessory:spacer")?.tier).toBe("awareness");
    expect(get(items, "accessory:spacer")?.satisfied).toBe(false);
    expect(setupComplete(items)).toBe(true); // awareness doesn't block
  });
});

describe("accessoriesFromRequiredComponents", () => {
  it("keeps awareness supplies, drops data-bearing ones, dedupes, sets source", () => {
    const out = accessoriesFromRequiredComponents(
      [
        { type: "syringe" }, // data-bearing → dropped (covered by rules)
        { type: "diluent" }, // data-bearing → dropped
        { type: "spacer", inferred: true },
        { type: "face_mask", inferred: false },
        { type: "spacer" }, // dupe → dropped
        { type: "unknown_thing" }, // not in allowlist → dropped
      ],
      "prescription"
    );
    expect(out.map((a) => a.type)).toEqual(["spacer", "face_mask"]);
    expect(out.find((a) => a.type === "spacer")?.source).toBe("inferred");
    expect(out.find((a) => a.type === "face_mask")?.source).toBe("prescription");
    expect(out.every((a) => a.acknowledged === false)).toBe(true);
  });
});

describe("mergeAccessories", () => {
  it("preserves prior acknowledged state on re-extraction (idempotent)", () => {
    const existing = [
      { type: "spacer", label: "Spacer", source: "inferred" as const, acknowledged: true },
    ];
    const incoming = [
      { type: "spacer", label: "Spacer", source: "prescription" as const, acknowledged: false },
      { type: "oral_syringe", label: "Oral syringe", source: "inferred" as const, acknowledged: false },
    ];
    const merged = mergeAccessories(existing, incoming);
    expect(merged.find((a) => a.type === "spacer")?.acknowledged).toBe(true); // preserved
    expect(merged.find((a) => a.type === "oral_syringe")?.acknowledged).toBe(false);
    expect(merged).toHaveLength(2);
  });
});
