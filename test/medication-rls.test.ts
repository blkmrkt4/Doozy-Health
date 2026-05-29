import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  STACK_READY,
  adminClient,
  createUser,
  ownedPatientId,
  signedInClient,
} from "./helpers";

/**
 * Medication scoping + the is_private override (PRD §5.6, §15).
 *
 * The privacy invariant is enforced in the RLS predicate, not just the UI:
 * a caregiver cannot read a private medication even with a direct query.
 * Also covers cross-patient denial, owner-only writes, and the
 * one-active-chosen-regimen constraint.
 */

const prescribed = {
  dose_amount: 200,
  dose_unit: "mg",
  route: "intramuscular",
  frequency: { type: "every", interval: 1, unit: "week" },
};
const delivery = { form_type: "vial" };

async function createMed(
  client: SupabaseClient,
  patientId: string,
  name: string,
  isPrivate: boolean
): Promise<string> {
  const { data, error } = await client.rpc("create_manual_medication", {
    p_patient_id: patientId,
    p_display_name: name,
    p_is_private: isPrivate,
    p_prescribed: prescribed,
    p_delivery: delivery,
    p_chosen: prescribed,
  });
  if (error) throw new Error(`createMed ${name}: ${error.message}`);
  return data as string;
}

describe.skipIf(!STACK_READY)("medication RLS + is_private override", () => {
  const admin = STACK_READY ? adminClient() : (null as unknown as SupabaseClient);
  const stamp = Date.now();
  const ownerEmail = `med-owner-${stamp}@example.test`;
  const caregiverEmail = `med-cg-${stamp}@example.test`;
  const strangerEmail = `med-stranger-${stamp}@example.test`;

  let ownerId = "";
  let caregiverId = "";
  let strangerId = "";
  let patientId = "";
  let publicMedId = "";
  let privateMedId = "";

  beforeAll(async () => {
    ownerId = await createUser(admin, ownerEmail);
    caregiverId = await createUser(admin, caregiverEmail);
    strangerId = await createUser(admin, strangerEmail);

    patientId = await ownedPatientId(admin, ownerId);

    // Attach the caregiver to the owner's patient. (The invite UI lands in
    // step 13; for the test we insert the membership directly.)
    const { error: mErr } = await admin.from("patient_memberships").insert({
      patient_id: patientId,
      user_id: caregiverId,
      role: "caregiver",
      accepted_at: new Date().toISOString(),
    });
    if (mErr) throw new Error(`caregiver membership: ${mErr.message}`);

    // Owner creates one public and one private medication via the real RPC.
    const owner = await signedInClient(ownerEmail);
    publicMedId = await createMed(owner, patientId, "Public med", false);
    privateMedId = await createMed(owner, patientId, "Private med", true);
  });

  afterAll(async () => {
    if (!STACK_READY) return;
    for (const uid of [ownerId, caregiverId, strangerId]) {
      if (uid) await admin.auth.admin.deleteUser(uid);
    }
  });

  it("owner sees both their medications", async () => {
    const owner = await signedInClient(ownerEmail);
    const { data } = await owner.from("medications").select("id");
    const ids = (data ?? []).map((r) => r.id).sort();
    expect(ids).toEqual([publicMedId, privateMedId].sort());
  });

  it("caregiver sees the public med but NOT the private one", async () => {
    const cg = await signedInClient(caregiverEmail);
    const { data } = await cg.from("medications").select("id");
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).toEqual([publicMedId]);
  });

  it("caregiver cannot read the private med even by direct id query", async () => {
    const cg = await signedInClient(caregiverEmail);
    const { data, error } = await cg
      .from("medications")
      .select("id")
      .eq("id", privateMedId);
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // …nor its child regimen rows.
    const { data: chosen } = await cg
      .from("chosen_regimens")
      .select("id")
      .eq("medication_id", privateMedId);
    expect(chosen).toEqual([]);
  });

  it("caregiver CAN read the public med's child regimens", async () => {
    const cg = await signedInClient(caregiverEmail);
    const { data } = await cg
      .from("chosen_regimens")
      .select("id")
      .eq("medication_id", publicMedId);
    expect((data ?? []).length).toEqual(1);
  });

  it("a non-member sees neither medication", async () => {
    const stranger = await signedInClient(strangerEmail);
    const { data } = await stranger
      .from("medications")
      .select("id")
      .in("id", [publicMedId, privateMedId]);
    expect(data).toEqual([]);
  });

  it("caregiver cannot create a medication (owner-only write)", async () => {
    const cg = await signedInClient(caregiverEmail);
    const { error } = await cg
      .from("medications")
      .insert({ patient_id: patientId, display_name: "Sneaky" });
    expect(error).not.toBeNull(); // RLS WITH CHECK rejects non-owners
  });

  it("enforces one active chosen regimen per medication", async () => {
    const owner = await signedInClient(ownerEmail);
    const { error } = await owner.from("chosen_regimens").insert({
      medication_id: publicMedId,
      patient_id: patientId,
      dose_amount: 100,
      dose_unit: "mg",
      route: "intramuscular",
      frequency: { type: "every", interval: 1, unit: "week" },
      active: true,
    });
    expect(error).not.toBeNull(); // partial unique index violation
  });
});
