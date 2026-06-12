import { describe, it, expect } from "vitest";
import {
  interactionDedupeKey,
  itemSupplyDedupeKey,
  medSupplyDedupeKey,
  overPrescribedDedupeKey,
} from "@/lib/notifications";

// Dedupe keys carry the anti-overwhelm contract: the same condition must
// always produce the same key (the unique constraint swallows re-evaluations),
// and a genuinely new condition must open a new bucket.

describe("notification dedupe keys", () => {
  it("interaction key is symmetric in pair order", () => {
    expect(interactionDedupeKey("drug-b", "drug-a")).toBe(
      interactionDedupeKey("drug-a", "drug-b")
    );
    expect(interactionDedupeKey("drug-a", "drug-b")).toBe("interaction:drug-a:drug-b");
  });

  it("medication supply key buckets by fill (delivery form id)", () => {
    const k1 = medSupplyDedupeKey("med-1", "fill-1");
    // Same fill re-evaluated on every dose log → same key, no re-notification.
    expect(medSupplyDedupeKey("med-1", "fill-1")).toBe(k1);
    // A refill is a new delivery_forms row → fresh bucket.
    expect(medSupplyDedupeKey("med-1", "fill-2")).not.toBe(k1);
  });

  it("item supply key buckets by the owner-entered recount timestamp", () => {
    const k1 = itemSupplyDedupeKey("item-1", "2026-06-01T10:00:00.000Z");
    expect(itemSupplyDedupeKey("item-1", "2026-06-01T10:00:00.000Z")).toBe(k1);
    // Restock (new count) opens a new bucket.
    expect(itemSupplyDedupeKey("item-1", "2026-06-10T10:00:00.000Z")).not.toBe(k1);
    // Equivalent instants in different ISO spellings collapse to one bucket.
    expect(itemSupplyDedupeKey("item-1", "2026-06-01T12:00:00+02:00")).toBe(k1);
    // Untracked timestamp still yields a stable key.
    expect(itemSupplyDedupeKey("item-1", null)).toBe(itemSupplyDedupeKey("item-1", null));
  });

  it("over-amount key buckets by the latest example date", () => {
    const k1 = overPrescribedDedupeKey("med-1", "2026-06-10");
    // Regenerating the same snapshot (or an overlapping window covering the
    // same event) → same key.
    expect(overPrescribedDedupeKey("med-1", "2026-06-10")).toBe(k1);
    // A new over-amount day notifies once more.
    expect(overPrescribedDedupeKey("med-1", "2026-06-11")).not.toBe(k1);
  });
});
