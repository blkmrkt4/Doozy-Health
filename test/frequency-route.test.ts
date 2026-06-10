import { describe, it, expect } from "vitest";
import { normaliseFrequency, normaliseRoute } from "@/lib/types";

// normaliseFrequency turns a label's cadence phrase into a structured schedule
// (deterministic, no LLM — rule #8). normaliseRoute now also maps eye/ear/nose
// phrasings onto the new ophthalmic/otic/nasal routes.

describe("normaliseFrequency", () => {
  it("parses the eyedrop example to once-a-day (cadence only)", () => {
    // The site ("both eyes") and time ("before bed") are ignored here — they
    // stay verbatim in Directions; only the cadence drives the schedule.
    expect(normaliseFrequency("one drop in both eyes once per day before bed")).toEqual({
      type: "every",
      interval: 1,
      unit: "day",
    });
  });

  it("parses common daily cadences", () => {
    expect(normaliseFrequency("once daily")).toEqual({ type: "every", interval: 1, unit: "day" });
    expect(normaliseFrequency("daily")).toEqual({ type: "every", interval: 1, unit: "day" });
    expect(normaliseFrequency("every day")).toEqual({ type: "every", interval: 1, unit: "day" });
  });

  it("parses N-times-per-day/week", () => {
    expect(normaliseFrequency("twice a day")).toEqual({ type: "times_per", count: 2, period: "day" });
    expect(normaliseFrequency("three times a day")).toEqual({ type: "times_per", count: 3, period: "day" });
    expect(normaliseFrequency("3 times per week")).toEqual({ type: "times_per", count: 3, period: "week" });
  });

  it("parses every-N-unit and every-other-day", () => {
    expect(normaliseFrequency("every 8 hours")).toEqual({ type: "every", interval: 8, unit: "hour" });
    expect(normaliseFrequency("every 3 days")).toEqual({ type: "every", interval: 3, unit: "day" });
    expect(normaliseFrequency("every other day")).toEqual({ type: "every", interval: 2, unit: "day" });
  });

  it("parses weekly / monthly and Latin shorthand", () => {
    expect(normaliseFrequency("once a week")).toEqual({ type: "every", interval: 1, unit: "week" });
    expect(normaliseFrequency("monthly")).toEqual({ type: "every", interval: 1, unit: "month" });
    expect(normaliseFrequency("BID")).toEqual({ type: "times_per", count: 2, period: "day" });
    expect(normaliseFrequency("q8h")).toEqual({ type: "every", interval: 8, unit: "hour" });
  });

  it("recognises as-needed and returns null on garbage", () => {
    expect(normaliseFrequency("take as needed")).toEqual({ type: "as_needed" });
    expect(normaliseFrequency("")).toBeNull();
    expect(normaliseFrequency("apply to the affected area")).toBeNull();
  });
});

describe("normaliseRoute — eye / ear / nose", () => {
  it("maps eye phrasings to ophthalmic", () => {
    expect(normaliseRoute("ophthalmic")).toBe("ophthalmic");
    expect(normaliseRoute("in both eyes")).toBe("ophthalmic");
    expect(normaliseRoute("each eye")).toBe("ophthalmic");
    expect(normaliseRoute("instill in the affected eye")).toBe("ophthalmic");
  });

  it("maps ear phrasings to otic and nose phrasings to nasal", () => {
    expect(normaliseRoute("otic")).toBe("otic");
    expect(normaliseRoute("in both ears")).toBe("otic");
    expect(normaliseRoute("nasal")).toBe("nasal");
    expect(normaliseRoute("intranasal")).toBe("nasal");
    expect(normaliseRoute("one spray in each nostril")).toBe("nasal");
  });

  it("still maps the existing routes", () => {
    expect(normaliseRoute("by mouth")).toBe("oral");
    expect(normaliseRoute("sub-Q")).toBe("subcutaneous");
    expect(normaliseRoute("nonsense")).toBeNull();
  });
});
