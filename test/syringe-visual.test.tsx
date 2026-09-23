import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SyringeVisual } from "@/app/medications/_components/syringe-visual";

const props = { doseAmount: 60, concentrationAmount: 200, concentrationPerVolume: 1, syringeCapacityMl: 1 };

describe("syringe scale", () => {
  it("uses the entered spacing rather than choosing ticks from capacity", () => {
    const html = renderToStaticMarkup(<SyringeVisual {...props} syringeUnitMarkings="0.2 mL increments" />);
    expect(html.match(/<text\b/g)).toHaveLength(6);
    expect(html).toContain("0.3");
    expect(html).not.toContain("markings have not been entered");
  });
  it("does not draw a calibrated scale when markings are unknown", () => {
    const html = renderToStaticMarkup(<SyringeVisual {...props} />);
    expect(html).not.toContain("<text");
    expect(html).toContain("Syringe markings have not been entered");
    expect(html).not.toContain("Fill to");
  });
  it("does not invent a syringe capacity", () => {
    expect(renderToStaticMarkup(<SyringeVisual {...props} syringeCapacityMl={0} />)).toBe("");
  });
});
