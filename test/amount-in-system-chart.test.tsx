import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AmountInSystemChart } from "@/app/_components/amount-in-system-chart";
import { eventsFromWeeklyPattern, type DrugPK, type PrescribedRegimen } from "@/lib/pk/amountInSystem";

const TEST: DrugPK = {
  name: "Testosterone",
  route: "intramuscular",
  unit: "mg",
  halfLifeDays: 8,
  isLinear: true,
  model: "amount_in_system",
};
const DOSES = eventsFromWeeklyPattern({ perDose: 65, weekdays: [0, 2, 4], weeks: 16 });
const RX: PrescribedRegimen = {
  perDose: 65,
  intervalDays: 7 / 3,
  perPeriodDose: 200,
  perPeriodLabel: "200 mg = one week's dose (what goes in)",
};

describe("AmountInSystemChart", () => {
  it("renders the testosterone curve with steady band, period reference, and footer", () => {
    const html = renderToStaticMarkup(
      <AmountInSystemChart drug={TEST} doses={DOSES} prescribed={RX} />
    );
    expect(html).toContain("<svg");
    expect(html).toMatch(/steady level ≈ 3\d\d mg on board/); // plateau ≈ 320
    expect(html).toContain("one week&#x27;s dose"); // period reference (the input)
    expect(html).toContain("not medical advice"); // footer always present
    expect(html).toContain("weeks"); // weeks axis for an 8-day half-life
    // never alarm-red / warning colour on this chart
    expect(html.toLowerCase()).not.toMatch(/red|crimson|#f00|#ff0000/);
  });

  it("shows the no-curve panel for a non-linear drug (no <svg>)", () => {
    const html = renderToStaticMarkup(
      <AmountInSystemChart drug={{ ...TEST, isLinear: false }} doses={DOSES} prescribed={RX} />
    );
    expect(html).not.toContain("<svg");
    expect(html).toContain("follow simple curve maths");
  });

  it("uses a days axis for a short half-life drug (sertraline)", () => {
    const sertraline: DrugPK = { ...TEST, name: "Sertraline", route: "oral", halfLifeDays: 1.1 };
    const daily = eventsFromWeeklyPattern({ perDose: 50, weekdays: [0, 1, 2, 3, 4, 5, 6], weeks: 2 });
    const html = renderToStaticMarkup(
      <AmountInSystemChart drug={sertraline} doses={daily} prescribed={{ perDose: 50, intervalDays: 1 }} />
    );
    expect(html).toContain(">days<");
  });
});
