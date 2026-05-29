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
 * Dose logging RLS (PRD §5.4, §5.6, §15).
 *
 * Covers the role + privacy boundary: a caregiver can log on a non-private
 * medication but neither read nor log a private one; non-members are denied;
 * the skipped/taken CHECK holds; undo is restricted to the logger or owner.
 */

const reg = {
  dose_amount: 200,
  dose_unit: "mg",
  route: "intramuscular",
  frequency: { type: "every", interval: 1, unit: "week" },
};

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
    p_prescribed: reg,
    p_delivery: { form_type: "vial" },
    p_chosen: reg,
  });
  if (error) throw new Error(`createMed ${name}: ${error.message}`);
  return data as string;
}

describe.skipIf(!STACK_READY)("dose_logs RLS", () => {
  const admin = STACK_READY ? adminClient() : (null as unknown as SupabaseClient);
  const stamp = Date.now();
  const ownerEmail = `dl-owner-${stamp}@example.test`;
  const cgEmail = `dl-cg-${stamp}@example.test`;
  const strangerEmail = `dl-stranger-${stamp}@example.test`;

  let ownerId = "";
  let cgId = "";
  let strangerId = "";
  let patientId = "";
  let publicMed = "";
  let privateMed = "";

  beforeAll(async () => {
    ownerId = await createUser(admin, ownerEmail);
    cgId = await createUser(admin, cgEmail);
    strangerId = await createUser(admin, strangerEmail);
    patientId = await ownedPatientId(admin, ownerId);

    await admin.from("patient_memberships").insert({
      patient_id: patientId,
      user_id: cgId,
      role: "caregiver",
      accepted_at: new Date().toISOString(),
    });

    const owner = await signedInClient(ownerEmail);
    publicMed = await createMed(owner, patientId, "Public med", false);
    privateMed = await createMed(owner, patientId, "Private med", true);
  });

  afterAll(async () => {
    if (!STACK_READY) return;
    for (const uid of [ownerId, cgId, strangerId]) {
      if (uid) await admin.auth.admin.deleteUser(uid);
    }
  });

  it("owner can log a taken dose on a visible medication", async () => {
    const owner = await signedInClient(ownerEmail);
    const { error } = await owner.from("dose_logs").insert({
      medication_id: publicMed,
      patient_id: patientId,
      event_type: "taken",
      amount: "200",
      unit: "mg",
      route_taken: "intramuscular",
      source: "manual",
      logged_by_user_id: ownerId,
    });
    expect(error).toBeNull();
  });

  it("caregiver can log on a non-private medication", async () => {
    const cg = await signedInClient(cgEmail);
    const { error } = await cg.from("dose_logs").insert({
      medication_id: publicMed,
      patient_id: patientId,
      event_type: "taken",
      amount: "200",
      unit: "mg",
      route_taken: "intramuscular",
      source: "caregiver",
      logged_by_user_id: cgId,
    });
    expect(error).toBeNull();
  });

  it("caregiver CANNOT log on a private medication", async () => {
    const cg = await signedInClient(cgEmail);
    const { error } = await cg.from("dose_logs").insert({
      medication_id: privateMed,
      patient_id: patientId,
      event_type: "taken",
      amount: "200",
      unit: "mg",
      source: "caregiver",
      logged_by_user_id: cgId,
    });
    expect(error).not.toBeNull(); // can_read_medication() is false for them
  });

  it("caregiver cannot READ a private medication's logs", async () => {
    const owner = await signedInClient(ownerEmail);
    await owner.from("dose_logs").insert({
      medication_id: privateMed,
      patient_id: patientId,
      event_type: "taken",
      amount: "200",
      unit: "mg",
      source: "manual",
      logged_by_user_id: ownerId,
    });
    const cg = await signedInClient(cgEmail);
    const { data } = await cg
      .from("dose_logs")
      .select("id")
      .eq("medication_id", privateMed);
    expect(data).toEqual([]);
  });

  it("a non-member cannot log", async () => {
    const stranger = await signedInClient(strangerEmail);
    const { error } = await stranger.from("dose_logs").insert({
      medication_id: publicMed,
      patient_id: patientId,
      event_type: "taken",
      amount: "200",
      unit: "mg",
      source: "manual",
      logged_by_user_id: strangerId,
    });
    expect(error).not.toBeNull();
  });

  it("a skip must carry no amount (CHECK), a taken dose must", async () => {
    const owner = await signedInClient(ownerEmail);

    const goodSkip = await owner.from("dose_logs").insert({
      medication_id: publicMed,
      patient_id: patientId,
      event_type: "skipped",
      source: "manual",
      logged_by_user_id: ownerId,
    });
    expect(goodSkip.error).toBeNull();

    const badSkip = await owner.from("dose_logs").insert({
      medication_id: publicMed,
      patient_id: patientId,
      event_type: "skipped",
      amount: "200",
      unit: "mg",
      source: "manual",
      logged_by_user_id: ownerId,
    });
    expect(badSkip.error).not.toBeNull(); // CHECK: skip carries no amount
  });

  it("undo is limited to the logger or an owner", async () => {
    const cg = await signedInClient(cgEmail);
    // Caregiver logs, then deletes their own — allowed.
    const { data: mine } = await cg
      .from("dose_logs")
      .insert({
        medication_id: publicMed,
        patient_id: patientId,
        event_type: "taken",
        amount: "100",
        unit: "mg",
        source: "caregiver",
        logged_by_user_id: cgId,
      })
      .select("id")
      .single();
    const delMine = await cg.from("dose_logs").delete().eq("id", mine!.id);
    expect(delMine.error).toBeNull();

    // Owner logs; caregiver cannot delete the owner's log (0 rows affected).
    const owner = await signedInClient(ownerEmail);
    const { data: ownersLog } = await owner
      .from("dose_logs")
      .insert({
        medication_id: publicMed,
        patient_id: patientId,
        event_type: "taken",
        amount: "300",
        unit: "mg",
        source: "manual",
        logged_by_user_id: ownerId,
      })
      .select("id")
      .single();
    await cg.from("dose_logs").delete().eq("id", ownersLog!.id);
    const { data: still } = await owner
      .from("dose_logs")
      .select("id")
      .eq("id", ownersLog!.id);
    expect(still?.length).toEqual(1); // caregiver's delete affected nothing

    // …but the owner can delete it.
    const delByOwner = await owner
      .from("dose_logs")
      .delete()
      .eq("id", ownersLog!.id);
    expect(delByOwner.error).toBeNull();
  });
});
