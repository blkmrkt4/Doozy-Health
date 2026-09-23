import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { injectionDoseDetails } from "@/lib/injection-dose";
import { InjectionDoseExplanation } from "@/app/medications/_components/injection-dose-explanation";
import { defaultDoseText, buildQuickLogFormData } from "@/lib/quick-log";
import type { MedLogMeta } from "@/lib/adherence";
import type { WeeklyFrequency } from "@/lib/types";

const frequency: WeeklyFrequency = { type: "weekly", days: [1, 3, 5], time: null, time_zone: "America/Toronto", weekly_total: 190 };
const opts = { doseAmount: 190 / 3, doseUnit: "mg", concentrationAmount: 200, concentrationUnit: "mg", concentrationPerVolume: 1, frequency };
const meta: MedLogMeta = { medId: "example", name: "Example", colour: "", defaultAmount: 190 / 3, defaultUnit: "mg", defaultRoute: "intramuscular", isInjectable: true, concentrationAmount: 200, concentrationPerVolume: 1, syringeCapacityMl: 1 };
const details = { concentrationUnit: "mg", frequency, syringeUnitMarkings: "0.1 mL increments" };

describe("saved injection explanation", () => {
  it("connects 190 mg weekly to the exact per-dose amount and vial volume", () => {
    const result = injectionDoseDetails(opts)!;
    expect(result.medicationAmount).toBe(190 / 3);
    expect(result.volumeMl).toBeCloseTo(0.31666666666666665, 12);
    expect(result.weeklyAmount).toBe(190);
    const html = renderToStaticMarkup(<InjectionDoseExplanation meta={meta} amount={meta.defaultAmount} details={details} />);
    expect(html).toContain("approximately 63.33");
    expect(html).toContain("approximately 0.3167");
    expect(html).toContain("mL of liquid");
    expect(html).toContain("3 doses per week add");
    expect(html).toContain("190");
  });
  it("updates volume when the vial concentration changes", () => {
    expect(injectionDoseDetails({ ...opts, concentrationAmount: 100 })!.volumeMl).toBeCloseTo(0.6333333333333333);
  });
  it("converts compatible mass or volume units without confusing mg and mL", () => {
    expect(injectionDoseDetails({ ...opts, doseAmount: 60000, doseUnit: "mcg", frequency: undefined })!.volumeMl).toBeCloseTo(0.3);
    expect(injectionDoseDetails({ ...opts, doseAmount: 0.3, doseUnit: "mL", frequency: undefined })!.medicationAmount).toBe(60);
    expect(injectionDoseDetails({ ...opts, doseUnit: "IU" })).toBeNull();
  });
  it("updates the edited amount and stops presenting it as the saved weekly plan", () => {
    const html = renderToStaticMarkup(<InjectionDoseExplanation meta={meta} amount={50} details={details} />);
    expect(html).toContain("Amount to record");
    expect(html).toContain("0.25");
    expect(html).toContain("differs from the dose in your saved plan");
    expect(html).not.toContain("3 doses per week");
  });
  it("records the full saved mg amount instead of converting a rounded mL display", () => {
    const display = defaultDoseText(meta, "regimen");
    expect(display.unitLabel).toBe("mg");
    const fd = buildQuickLogFormData({ meta, doseText: display.doseText, dayMs: 0, isToday: true, doseBasis: "regimen" })!;
    expect(Number(fd.get("amount"))).toBe(190 / 3);
    expect(fd.get("unit")).toBe("mg");
    expect(fd.get("note")).toBeNull();
    const edited = buildQuickLogFormData({ meta, doseText: "50", dayMs: 0, isToday: true, doseBasis: "regimen" })!;
    expect(Number(edited.get("amount"))).toBe(50);
  });
  it("does not draw a volume from missing or invalid concentration", () => {
    expect(injectionDoseDetails({ ...opts, concentrationPerVolume: 0 })).toBeNull();
    expect(injectionDoseDetails({ ...opts, concentrationAmount: Infinity })).toBeNull();
  });
});
