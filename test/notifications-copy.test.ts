import { describe, it, expect } from "vitest";
import {
  renderNotification,
  type NotificationType,
} from "@/lib/notifications";

// The §6.1 lexical backstop for notification copy. Every rendered variant must
// inform, never direct: no dosing instruction, no refill imperative, no banned
// regulatory verbs, and the over-amount note compares against the regimen on
// record — never a "labeled maximum" we don't hold data for.

const NOW = new Date("2026-06-12T12:00:00").getTime();

// Banned in any rendered title/body (the curated mechanism detail is ground
// truth passed through verbatim and is not generated copy).
const BANNED: RegExp[] = [
  /do not take/i,
  /\bavoid\b/i,
  /\brefill/i,
  /\border\b/i,
  /dose now/i,
  /\boverdose/i,
  /\bshould\b/i,
  /\btreat/i,
  /\bdiagnos/i,
  /\bcure\b/i,
  /\bprescri/i, // "prescribe(d)" — copy says "the amount on record" instead
  /\bmust\b/i,
];

type Variant = { type: NotificationType; payload: Record<string, unknown> };

const VARIANTS: Variant[] = [
  {
    type: "supply_low_medication",
    payload: {
      medName: "Metformin",
      remaining: 12.34,
      packageUnit: "tablets",
      runOutAtISO: "2026-06-19T10:00:00.000Z",
    },
  },
  {
    type: "supply_low_medication",
    payload: { medName: "Metformin", remaining: 0, packageUnit: "tablets", runOutAtISO: null },
  },
  {
    type: "supply_low_medication",
    payload: { medName: "Metformin", remaining: 3, packageUnit: "mL", runOutAtISO: null },
  },
  {
    type: "supply_low_item",
    payload: {
      label: "1 mL insulin syringes",
      quantity: 6,
      runOutAtISO: "2026-06-18T10:00:00.000Z",
    },
  },
  {
    type: "supply_low_item",
    payload: { label: "1 mL insulin syringes", quantity: 0, runOutAtISO: null },
  },
  {
    type: "interaction",
    payload: { aName: "sertraline", bName: "alcohol (tracked in diary)", mechanism: "CNS effects" },
  },
  {
    type: "dose_above_prescribed",
    payload: {
      medName: "Acetaminophen",
      date: "2026-06-10",
      loggedLabel: "1500 mg",
      prescribedLabel: "1000 mg",
    },
  },
  // Degenerate payloads must still render something safe.
  { type: "supply_low_medication", payload: {} },
  { type: "supply_low_item", payload: {} },
  { type: "interaction", payload: {} },
  { type: "dose_above_prescribed", payload: {} },
];

describe("renderNotification — §6.1 lexical backstop", () => {
  for (const v of VARIANTS) {
    it(`${v.type} (${Object.keys(v.payload).length ? "full" : "empty"} payload) contains no banned language`, () => {
      const r = renderNotification(v.type, v.payload, NOW);
      const text = `${r.title}\n${r.body}`;
      for (const banned of BANNED) {
        expect(text).not.toMatch(banned);
      }
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.body.length).toBeGreaterThan(0);
    });
  }
});

describe("renderNotification — factual phrasing", () => {
  it("medication supply: projected date + estimate framing", () => {
    const r = renderNotification(
      "supply_low_medication",
      {
        medName: "Metformin",
        remaining: 12.34,
        packageUnit: "tablets",
        runOutAtISO: "2026-06-19T10:00:00.000Z",
      },
      NOW
    );
    expect(r.title).toBe("Supply estimate — Metformin");
    expect(r.body).toContain("projected to run out around Jun 19");
    expect(r.body).toContain("about 12.3 tablets left");
    expect(r.body).toContain("estimate based on what you've logged");
  });

  it("medication supply: used-up fill is a record, not an instruction", () => {
    const r = renderNotification(
      "supply_low_medication",
      { medName: "Metformin", remaining: 0, packageUnit: "tablets" },
      NOW
    );
    expect(r.body).toContain("used up");
    expect(r.body).toContain("Based on what you've logged");
  });

  it("item supply: usage-rate projection with the count", () => {
    const r = renderNotification(
      "supply_low_item",
      { label: "1 mL insulin syringes", quantity: 6, runOutAtISO: "2026-06-18T10:00:00.000Z" },
      NOW
    );
    expect(r.body).toContain("around Jun 18");
    expect(r.body).toContain("(6 left)");
  });

  it("interaction: informs and points at the clinician; mechanism is the detail", () => {
    const r = renderNotification(
      "interaction",
      { aName: "sertraline", bName: "alcohol (tracked in diary)", mechanism: "CNS effects" },
      NOW
    );
    expect(r.body).toContain("sertraline");
    expect(r.body).toContain("alcohol (tracked in diary)");
    expect(r.body).toContain("discuss with your doctor or pharmacist");
    expect(r.detail).toBe("CNS effects");
  });

  it("over-amount: references the regimen on record, never a labeled maximum", () => {
    const r = renderNotification(
      "dose_above_prescribed",
      {
        medName: "Acetaminophen",
        date: "2026-06-10",
        loggedLabel: "1500 mg",
        prescribedLabel: "1000 mg",
      },
      NOW
    );
    expect(r.body).toContain("On Jun 10");
    expect(r.body).toContain("1500 mg");
    expect(r.body).toContain("the amount on record is 1000 mg");
    expect(r.body).toContain("discuss with your doctor or pharmacist");
    expect(`${r.title} ${r.body}`.toLowerCase()).not.toContain("maximum");
  });

  it("shows the year only when it differs from the current one", () => {
    const r = renderNotification(
      "supply_low_medication",
      { medName: "X", remaining: 2, packageUnit: "mL", runOutAtISO: "2027-01-03T10:00:00.000Z" },
      NOW
    );
    expect(r.body).toContain("Jan 3, 2027");
  });
});
