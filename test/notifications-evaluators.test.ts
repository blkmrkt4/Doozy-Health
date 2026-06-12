import { describe, it, expect } from "vitest";
import {
  decideItemSupplyNotification,
  decideMedSupplyNotification,
  decideSnapshotNotifications,
  shouldNotifyInteraction,
} from "@/lib/notifications";
import type { RunOut } from "@/lib/supply";
import type { InteractionFact } from "@/lib/interactions";

// The pure decision layer behind the event hooks: threshold edges, PRN
// skipping, the "strong reason only" snapshot rules, and privacy routing.

const NOW = new Date("2026-06-12T12:00:00").getTime();

function runOut(partial: Partial<RunOut>): RunOut {
  return {
    remaining: 10,
    packageUnit: "tablets",
    unitsPerDay: 2,
    daysLeft: 5,
    runOutAt: new Date(NOW + 5 * 86_400_000),
    ranOut: false,
    ...partial,
  };
}

function fact(partial: Partial<InteractionFact>): InteractionFact {
  return {
    severity: "caution",
    mechanism: "m",
    aLabel: "A",
    bLabel: "B",
    aDrugId: "drug-a",
    bDrugId: "drug-b",
    aIsSubstance: false,
    bIsSubstance: false,
    ...partial,
  };
}

describe("decideMedSupplyNotification", () => {
  const base = {
    patientId: "p1",
    medicationId: "med-1",
    deliveryFormId: "fill-1",
    medName: "Metformin",
  };

  it("notifies at exactly the threshold (7 days left)", () => {
    const insert = decideMedSupplyNotification({ ...base, runOut: runOut({ daysLeft: 7 }) });
    expect(insert).not.toBeNull();
    expect(insert!.type).toBe("supply_low_medication");
    expect(insert!.severity).toBe("info");
    expect(insert!.medication_id).toBe("med-1");
    expect(insert!.dedupe_key).toBe("supply_low:med:med-1:fill-1");
  });

  it("stays quiet above the threshold (7.5 days left)", () => {
    expect(decideMedSupplyNotification({ ...base, runOut: runOut({ daysLeft: 7.5 }) })).toBeNull();
  });

  it("stays quiet with no projection (PRN / no package count)", () => {
    expect(decideMedSupplyNotification({ ...base, runOut: null })).toBeNull();
    // as-needed: no steady rate → daysLeft null
    expect(
      decideMedSupplyNotification({
        ...base,
        runOut: runOut({ unitsPerDay: null, daysLeft: null, runOutAt: null }),
      })
    ).toBeNull();
  });

  it("a used-up fill notifies even without a rate", () => {
    const insert = decideMedSupplyNotification({
      ...base,
      runOut: runOut({ remaining: 0, daysLeft: 0, unitsPerDay: null, ranOut: true }),
    });
    expect(insert).not.toBeNull();
    expect(insert!.payload.remaining).toBe(0);
  });
});

describe("decideItemSupplyNotification", () => {
  const base = {
    patientId: "p1",
    itemId: "item-1",
    label: "1 mL syringes",
    quantitySetAt: "2026-06-01T10:00:00.000Z",
    now: NOW,
  };

  it("14 injections over the 14-day window with 7 left → notify (7 days left)", () => {
    const insert = decideItemSupplyNotification({ ...base, quantity: 7, usageCount: 14 });
    expect(insert).not.toBeNull();
    expect(insert!.type).toBe("supply_low_item");
    expect(insert!.inventory_item_id).toBe("item-1");
    expect(insert!.medication_id).toBeNull();
  });

  it("8 left at one per day → quiet (8 days > threshold)", () => {
    expect(decideItemSupplyNotification({ ...base, quantity: 8, usageCount: 14 })).toBeNull();
  });

  it("no recent usage → no rate → quiet, regardless of count", () => {
    expect(decideItemSupplyNotification({ ...base, quantity: 1, usageCount: 0 })).toBeNull();
  });
});

describe("shouldNotifyInteraction — strong reason only", () => {
  it("serious always notifies", () => {
    expect(shouldNotifyInteraction(fact({ severity: "serious" }))).toBe(true);
  });
  it("caution notifies only with a logged-substance side", () => {
    expect(shouldNotifyInteraction(fact({ severity: "caution" }))).toBe(false);
    expect(shouldNotifyInteraction(fact({ severity: "caution", bIsSubstance: true }))).toBe(true);
  });
  it("info never notifies", () => {
    expect(shouldNotifyInteraction(fact({ severity: "info", aIsSubstance: true }))).toBe(false);
  });
});

describe("decideSnapshotNotifications", () => {
  const base = { patientId: "p1", reportSummaryId: "rs-1", overDose: [] };

  it("routes the notification to the PRIVATE medication's id when one side is private", () => {
    const medsByDrugId = new Map([
      ["drug-a", { id: "med-a", isPrivate: false }],
      ["drug-b", { id: "med-b", isPrivate: true }],
    ]);
    const inserts = decideSnapshotNotifications({
      ...base,
      interactions: [fact({ severity: "serious" })],
      medsByDrugId,
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].medication_id).toBe("med-b");
    expect(inserts[0].severity).toBe("serious");
    expect(inserts[0].report_summary_id).toBe("rs-1");
  });

  it("substance-only pairs carry no medication id", () => {
    const inserts = decideSnapshotNotifications({
      ...base,
      interactions: [
        fact({ severity: "serious", aIsSubstance: true, bIsSubstance: true }),
      ],
      medsByDrugId: new Map(),
    });
    expect(inserts[0].medication_id).toBeNull();
  });

  it("filters by the notify rule and dedupes by sorted pair key", () => {
    const inserts = decideSnapshotNotifications({
      ...base,
      interactions: [
        fact({ severity: "caution" }), // med×med caution → snapshot-only
        fact({ severity: "caution", aIsSubstance: true, aDrugId: "drug-z" }),
      ],
      medsByDrugId: new Map(),
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].dedupe_key).toBe("interaction:drug-b:drug-z");
  });

  it("over-amount entries become neutral info records keyed by example date", () => {
    const inserts = decideSnapshotNotifications({
      ...base,
      interactions: [],
      medsByDrugId: new Map(),
      overDose: [
        {
          medicationId: "med-1",
          medName: "Acetaminophen",
          date: "2026-06-10",
          loggedLabel: "1500 mg",
          prescribedLabel: "1000 mg",
        },
      ],
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].type).toBe("dose_above_prescribed");
    expect(inserts[0].severity).toBe("info");
    expect(inserts[0].medication_id).toBe("med-1");
    expect(inserts[0].dedupe_key).toBe("over_prescribed:med:med-1:2026-06-10");
  });
});
