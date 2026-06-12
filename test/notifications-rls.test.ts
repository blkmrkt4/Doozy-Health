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
 * Notifications RLS (PRD §5.6/§7 + the medication-privacy override).
 *
 * The invariants: members read the patient's notifications, EXCEPT rows whose
 * medication_id points at a private medication (owner-only via
 * can_read_medication); clients can never insert notifications (service-role
 * only); the (patient_id, dedupe_key) unique constraint is the anti-overwhelm
 * backstop; read marks are per user and only for visible notifications.
 */

const prescribed = {
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
    p_prescribed: prescribed,
    p_delivery: { form_type: "vial" },
    p_chosen: prescribed,
  });
  if (error) throw new Error(`createMed ${name}: ${error.message}`);
  return data as string;
}

describe.skipIf(!STACK_READY)("notifications RLS", () => {
  const admin = STACK_READY ? adminClient() : (null as unknown as SupabaseClient);
  const stamp = Date.now();
  const ownerEmail = `notif-owner-${stamp}@example.test`;
  const caregiverEmail = `notif-cg-${stamp}@example.test`;
  const strangerEmail = `notif-stranger-${stamp}@example.test`;

  let ownerId = "";
  let caregiverId = "";
  let strangerId = "";
  let patientId = "";
  let publicMedId = "";
  let privateMedId = "";
  let publicNotifId = "";
  let privateNotifId = "";
  let generalNotifId = "";

  async function insertNotification(
    medicationId: string | null,
    dedupeKey: string
  ): Promise<string> {
    const { data, error } = await admin
      .from("notifications")
      .insert({
        patient_id: patientId,
        type: medicationId ? "supply_low_medication" : "interaction",
        severity: "info",
        medication_id: medicationId,
        payload: {},
        dedupe_key: dedupeKey,
      })
      .select("id")
      .single();
    if (error) throw new Error(`insertNotification: ${error.message}`);
    return data.id as string;
  }

  beforeAll(async () => {
    ownerId = await createUser(admin, ownerEmail);
    caregiverId = await createUser(admin, caregiverEmail);
    strangerId = await createUser(admin, strangerEmail);
    patientId = await ownedPatientId(admin, ownerId);

    const { error: mErr } = await admin.from("patient_memberships").insert({
      patient_id: patientId,
      user_id: caregiverId,
      role: "caregiver",
      accepted_at: new Date().toISOString(),
    });
    if (mErr) throw new Error(`caregiver membership: ${mErr.message}`);

    const owner = await signedInClient(ownerEmail);
    publicMedId = await createMed(owner, patientId, "Public med", false);
    privateMedId = await createMed(owner, patientId, "Private med", true);

    publicNotifId = await insertNotification(publicMedId, `t:pub:${stamp}`);
    privateNotifId = await insertNotification(privateMedId, `t:priv:${stamp}`);
    generalNotifId = await insertNotification(null, `t:gen:${stamp}`);
  });

  afterAll(async () => {
    if (!STACK_READY) return;
    for (const uid of [ownerId, caregiverId, strangerId]) {
      if (uid) await admin.auth.admin.deleteUser(uid);
    }
  });

  it("owner sees all three notifications", async () => {
    const owner = await signedInClient(ownerEmail);
    const { data } = await owner.from("notifications").select("id");
    const ids = (data ?? []).map((r) => r.id);
    expect(ids.sort()).toEqual([publicNotifId, privateNotifId, generalNotifId].sort());
  });

  it("caregiver sees the public + general rows but NOT the private-medication one", async () => {
    const cg = await signedInClient(caregiverEmail);
    const { data } = await cg.from("notifications").select("id");
    const ids = (data ?? []).map((r) => r.id);
    expect(ids.sort()).toEqual([publicNotifId, generalNotifId].sort());

    // …not even by direct id query.
    const { data: direct } = await cg
      .from("notifications")
      .select("id")
      .eq("id", privateNotifId);
    expect(direct).toEqual([]);
  });

  it("a non-member sees nothing", async () => {
    const stranger = await signedInClient(strangerEmail);
    const { data } = await stranger
      .from("notifications")
      .select("id")
      .eq("patient_id", patientId);
    expect(data).toEqual([]);
  });

  it("clients cannot insert notifications — even the owner (service-role only)", async () => {
    const owner = await signedInClient(ownerEmail);
    const { error } = await owner.from("notifications").insert({
      patient_id: patientId,
      type: "interaction",
      severity: "info",
      payload: {},
      dedupe_key: `t:forged:${stamp}`,
    });
    expect(error).not.toBeNull();
  });

  it("the (patient_id, dedupe_key) unique constraint rejects duplicates", async () => {
    const { error } = await admin.from("notifications").insert({
      patient_id: patientId,
      type: "supply_low_medication",
      severity: "info",
      medication_id: publicMedId,
      payload: {},
      dedupe_key: `t:pub:${stamp}`, // already used in beforeAll
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23505");

    // …while ignoreDuplicates upsert (the createNotification path) is a quiet no-op.
    const { error: upsertErr } = await admin.from("notifications").upsert(
      {
        patient_id: patientId,
        type: "supply_low_medication",
        severity: "info",
        medication_id: publicMedId,
        payload: {},
        dedupe_key: `t:pub:${stamp}`,
      },
      { onConflict: "patient_id,dedupe_key", ignoreDuplicates: true }
    );
    expect(upsertErr).toBeNull();
  });

  it("read marks are per user: the owner's read does not clear the caregiver's", async () => {
    const owner = await signedInClient(ownerEmail);
    const { error } = await owner
      .from("notification_reads")
      .insert({ notification_id: publicNotifId, user_id: ownerId });
    expect(error).toBeNull();

    const cg = await signedInClient(caregiverEmail);
    const { data: cgReads } = await cg
      .from("notification_reads")
      .select("notification_id")
      .eq("notification_id", publicNotifId);
    expect(cgReads).toEqual([]); // caregiver's own marks only — still unread for them
  });

  it("a user cannot insert a read mark for another user", async () => {
    const owner = await signedInClient(ownerEmail);
    const { error } = await owner
      .from("notification_reads")
      .insert({ notification_id: generalNotifId, user_id: caregiverId });
    expect(error).not.toBeNull();
  });

  it("a user cannot mark a notification they cannot see", async () => {
    const cg = await signedInClient(caregiverEmail);
    const { error } = await cg
      .from("notification_reads")
      .insert({ notification_id: privateNotifId, user_id: caregiverId });
    expect(error).not.toBeNull(); // WITH CHECK sub-select runs under notifications RLS
  });
});
