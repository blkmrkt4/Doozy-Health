import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncDrugs, type RxcuiLookup } from "@/lib/drug-sync";
import { DRUG_CATALOGUE, INTERACTION_CATALOGUE } from "@/lib/drug-catalogue";
import {
  STACK_READY,
  adminClient,
  createUser,
  ownedPatientId,
  signedInClient,
} from "./helpers";

/**
 * Reference drug database (PRD §13.3, §15-style coverage).
 *
 * The RxNorm lookup is STUBBED — no live external call in tests, mirroring the
 * OpenRouter rule. (`npm run sync:drugs` performs the real RxNorm enrichment.)
 */

// Deterministic stub standing in for the RxNorm rxcui lookup.
const stubLookup: RxcuiLookup = async (name) => `rxcui-${name}`;

describe.skipIf(!STACK_READY)("reference drug database", () => {
  const admin = STACK_READY ? adminClient() : (null as unknown as SupabaseClient);

  beforeAll(async () => {
    // Populate with known stub identities so assertions are deterministic.
    await syncDrugs(admin, stubLookup);
  });

  it("upserts the full catalogue with enriched identity", async () => {
    const { count } = await admin
      .from("drugs")
      .select("id", { count: "exact", head: true });
    expect(count).toEqual(DRUG_CATALOGUE.length);

    const { data } = await admin
      .from("drugs")
      .select("rxnorm_id, half_life_hours")
      .eq("canonical_name", "sertraline")
      .single();
    expect(data?.rxnorm_id).toEqual("rxcui-sertraline");
    // Curated PK params survive the sync.
    expect((data?.half_life_hours as Record<string, number>).oral).toEqual(26);
  });

  it("upserts the curated interactions", async () => {
    const { count } = await admin
      .from("drug_interactions")
      .select("id", { count: "exact", head: true });
    expect(count).toEqual(INTERACTION_CATALOGUE.length);
  });

  it("is idempotent (re-running does not duplicate)", async () => {
    await syncDrugs(admin, stubLookup);
    const { count: drugs } = await admin
      .from("drugs")
      .select("id", { count: "exact", head: true });
    const { count: inter } = await admin
      .from("drug_interactions")
      .select("id", { count: "exact", head: true });
    expect(drugs).toEqual(DRUG_CATALOGUE.length);
    expect(inter).toEqual(INTERACTION_CATALOGUE.length);
  });

  describe("as an authenticated user", () => {
    const email = `drug-reader-${Date.now()}@example.test`;
    let userId = "";

    beforeAll(async () => {
      userId = await createUser(admin, email);
    });
    afterAll(async () => {
      if (userId) await admin.auth.admin.deleteUser(userId);
    });

    it("can read reference drugs and interactions (global read)", async () => {
      const c = await signedInClient(email);
      const { data: drugs } = await c.from("drugs").select("id");
      expect((drugs ?? []).length).toEqual(DRUG_CATALOGUE.length);
      const { data: inter } = await c.from("drug_interactions").select("id");
      expect((inter ?? []).length).toEqual(INTERACTION_CATALOGUE.length);
    });

    it("drug-name lookup (ILIKE) returns matches", async () => {
      const c = await signedInClient(email);
      const { data } = await c
        .from("drugs")
        .select("canonical_name")
        .ilike("canonical_name", "%trama%");
      expect(data?.map((d) => d.canonical_name)).toEqual(["tramadol"]);
    });

    it("links a medication to a canonical drug via the RPC", async () => {
      const c = await signedInClient(email);
      const patientId = await ownedPatientId(admin, userId);
      const { data: drug } = await admin
        .from("drugs")
        .select("id")
        .eq("canonical_name", "sertraline")
        .single();

      const reg = {
        dose_amount: 50,
        dose_unit: "mg",
        route: "oral",
        frequency: { type: "every", interval: 1, unit: "day" },
      };
      const { data: medId, error } = await c.rpc("create_manual_medication", {
        p_patient_id: patientId,
        p_display_name: "Sertraline",
        p_is_private: false,
        p_prescribed: reg,
        p_delivery: { form_type: "pill_bottle" },
        p_chosen: reg,
        p_canonical_drug_id: drug!.id,
      });
      expect(error).toBeNull();

      const { data: med } = await c
        .from("medications")
        .select("canonical_drug_id")
        .eq("id", medId as string)
        .single();
      expect(med?.canonical_drug_id).toEqual(drug!.id);
    });
  });
});
