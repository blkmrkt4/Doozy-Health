import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DeliveryLabelFields } from "@/app/medications/_components/delivery-label-fields";
import { packageUnitsPerDose } from "@/lib/supply";
import type { RegimenInput } from "@/lib/regimen-plan";

describe("vial label entry", () => {
  const plan: RegimenInput = { dose_amount: 60, dose_unit: "mg", route: "intramuscular", frequency: { type: "weekly", days: [1, 4, 6], time: null, time_zone: "America/Toronto", weekly_total: 180 } };
  it("shows full doses and weeks for the chosen weekly schedule", () => {
    const html = renderToStaticMarkup(<DeliveryLabelFields formType="vial" onQuantityChange={() => {}} chosenPlan={plan} initial={{ formType: "vial", concAmount: "200", concUnit: "mg", concPerVolume: "1", packageCount: "5", packageUnit: "mL" }} />);
    expect(html).toContain("16 full doses, with some left over — about 5.6 weeks at your chosen schedule");
  });
  it("uses days for a daily schedule", () => {
    const html = renderToStaticMarkup(<DeliveryLabelFields formType="vial" onQuantityChange={() => {}} chosenPlan={{ ...plan, dose_amount: 50, frequency: { type: "every", interval: 1, unit: "day" } }} initial={{ formType: "vial", concAmount: "200", concUnit: "mg", concPerVolume: "1", packageCount: "5", packageUnit: "mL" }} />);
    expect(html).toContain("20 full doses — about 20 days at your chosen schedule");
  });
  it.each([[1000, 5], [200, 1]])("keeps a %s mg per %s mL label separate from a 5 mL vial", (amount, perVolume) => {
    const html = renderToStaticMarkup(<DeliveryLabelFields formType="vial" onQuantityChange={() => {}} initial={{
      formType: "vial", concAmount: String(amount), concUnit: "mg", concPerVolume: String(perVolume), packageCount: "5", packageUnit: "mL",
    }} />);
    expect(html).toContain("Each 1 mL contains 200 mg. This 5 mL vial contains 1,000 mg in total.");
    expect(html).toMatch(/name="package_count"[^>]*value="5"/);
    expect(html).toMatch(/name="package_unit"[^>]*value="mL"/);
    expect(html).not.toContain("Pack count");
    expect(packageUnitsPerDose(50, "mg", "mL", { amount, unit: "mg", per_volume: perVolume, volume_unit: "mL" })).toBe(0.25);
  });

  it("does not assume that the concentration's 1 mL is the vial volume", () => {
    const html = renderToStaticMarkup(<DeliveryLabelFields formType="vial" onQuantityChange={() => {}} initial={{ concAmount: "200", concPerVolume: "1" }} />);
    expect(html).toMatch(/name="package_count"[^>]*value=""/);
    expect(html).toContain("Each 1 mL contains 200 mg.");
    expect(html).not.toContain("in total.");
  });

  it.each(["vials", ""])("preserves old quantities measured in '%s' until explicitly replaced", (packageUnit) => {
    const html = renderToStaticMarkup(<DeliveryLabelFields formType="vial" onQuantityChange={() => {}} initial={{ formType: "vial", packageCount: "2", packageUnit }} />);
    expect(html).toMatch(/name="package_count"[^>]*value="2"/);
    expect(html).toMatch(new RegExp(`name="package_unit"[^>]*value="${packageUnit}"`));
    expect(html).toContain("Enter liquid volume instead");
    expect(html).not.toContain('type="hidden" name="package_unit" value="mL"');
  });

  it("keeps tablet inventory in its original units", () => {
    const html = renderToStaticMarkup(<DeliveryLabelFields formType="tablet" onQuantityChange={() => {}} initial={{ formType: "tablet", packageCount: "30", packageUnit: "tablets" }} />);
    expect(html).toContain("Pack count");
    expect(html).toMatch(/name="package_count"[^>]*value="30"/);
    expect(html).not.toContain("Each 1 mL");
  });
});
