import { describe, it, expect } from "vitest";
import { STACK_READY } from "./helpers";

// findInteractionsAmong (PRD §5.8, §5.10.1). Ground truth is the curated
// drug_interactions table only (hard rule #9). The Supabase client is stubbed —
// no real query. Gated on STACK_READY because importing lib/interactions loads
// server-only modules that validate env at import time.

function stubSupabase(rows: unknown[]) {
  const thenable = Promise.resolve({ data: rows });
  return {
    from() {
      return {
        select() {
          return { in() { return { in: () => thenable }; } };
        },
      };
    },
  } as never;
}

describe.skipIf(!STACK_READY)("findInteractionsAmong", () => {
  it("returns curated pairs among the set, deduped and severity-ordered", async () => {
    const { findInteractionsAmong } = await import("@/lib/interactions");
    const rows = [
      { drug_a_id: "a", drug_b_id: "b", severity: "caution", mechanism: "cns" },
      { drug_a_id: "b", drug_b_id: "c", severity: "serious", mechanism: "depress" },
      // duplicate of a|b — must be deduped
      { drug_a_id: "a", drug_b_id: "b", severity: "caution", mechanism: "cns" },
    ];
    const facts = await findInteractionsAmong(stubSupabase(rows), [
      { drugId: "a", label: "alcohol (tracked in diary)" },
      { drugId: "b", label: "citalopram" },
      { drugId: "c", label: "diazepam" },
    ]);

    expect(facts).toHaveLength(2);
    // serious sorts before caution
    expect(facts[0].severity).toBe("serious");
    expect(new Set([facts[0].aLabel, facts[0].bLabel])).toEqual(
      new Set(["citalopram", "diazepam"])
    );
    const ab = facts.find((f) => f.mechanism === "cns")!;
    expect(new Set([ab.aLabel, ab.bLabel])).toEqual(
      new Set(["alcohol (tracked in diary)", "citalopram"])
    );
  });

  it("returns nothing when fewer than two drugs are in scope", async () => {
    const { findInteractionsAmong } = await import("@/lib/interactions");
    expect(await findInteractionsAmong(stubSupabase([]), [{ drugId: "a", label: "x" }])).toEqual([]);
  });
});
