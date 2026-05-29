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
 * Documents + storage RLS (PRD §5.1, §6.2, §7, §13.5).
 *
 * Storage object keys are <patient_id>/<doc_id>.<ext>; access is checked
 * against the MEMBERSHIP SET (the §7 departure). is_private propagates to
 * storage reads via the documents-row visibility check.
 */

const PNG = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
  type: "image/png",
});

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

// Upload an object + insert its documents row as the given owner/caregiver
// client. Returns the storage path.
async function attach(
  client: SupabaseClient,
  patientId: string,
  medicationId: string,
  uploaderId: string
): Promise<string> {
  const docId = crypto.randomUUID();
  const path = `${patientId}/${docId}.png`;
  const up = await client.storage.from("documents").upload(path, PNG, {
    contentType: "image/png",
  });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  const { error } = await client.from("documents").insert({
    id: docId,
    patient_id: patientId,
    storage_path: path,
    file_name: "x.png",
    mime_type: "image/png",
    size_bytes: 4,
    document_type: "vial_photo",
    linked_medication_id: medicationId,
    uploaded_by: uploaderId,
  });
  if (error) throw new Error(`doc row: ${error.message}`);
  return path;
}

describe.skipIf(!STACK_READY)("documents + storage RLS", () => {
  const admin = STACK_READY ? adminClient() : (null as unknown as SupabaseClient);
  const stamp = Date.now();
  const ownerEmail = `doc-owner-${stamp}@example.test`;
  const cgEmail = `doc-cg-${stamp}@example.test`;
  const strangerEmail = `doc-stranger-${stamp}@example.test`;

  let ownerId = "";
  let cgId = "";
  let strangerId = "";
  let patientId = "";
  let publicMed = "";
  let privateMed = "";
  const paths: string[] = [];

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
    if (paths.length) await admin.storage.from("documents").remove(paths);
    for (const uid of [ownerId, cgId, strangerId]) {
      if (uid) await admin.auth.admin.deleteUser(uid);
    }
  });

  it("owner can upload into their patient's folder", async () => {
    const owner = await signedInClient(ownerEmail);
    const path = `${patientId}/${crypto.randomUUID()}.png`;
    const { error } = await owner.storage
      .from("documents")
      .upload(path, PNG, { contentType: "image/png" });
    expect(error).toBeNull();
    paths.push(path);
  });

  it("a non-member cannot upload into that folder", async () => {
    const stranger = await signedInClient(strangerEmail);
    const path = `${patientId}/${crypto.randomUUID()}.png`;
    const { error } = await stranger.storage
      .from("documents")
      .upload(path, PNG, { contentType: "image/png" });
    expect(error).not.toBeNull(); // folder not in stranger's membership set
  });

  it("caregiver sees a doc linked to a non-private med, not a private one", async () => {
    const owner = await signedInClient(ownerEmail);
    paths.push(await attach(owner, patientId, publicMed, ownerId));
    paths.push(await attach(owner, patientId, privateMed, ownerId));

    const cg = await signedInClient(cgEmail);
    const { data: pub } = await cg
      .from("documents")
      .select("id")
      .eq("linked_medication_id", publicMed);
    expect((pub ?? []).length).toEqual(1);

    const { data: priv } = await cg
      .from("documents")
      .select("id")
      .eq("linked_medication_id", privateMed);
    expect(priv).toEqual([]);
  });

  it("a non-member sees no documents", async () => {
    const stranger = await signedInClient(strangerEmail);
    const { data } = await stranger
      .from("documents")
      .select("id")
      .eq("patient_id", patientId);
    expect(data).toEqual([]);
  });

  it("storage read honours is_private (caregiver can sign a public-med object, not a private one)", async () => {
    const owner = await signedInClient(ownerEmail);
    const pubPath = await attach(owner, patientId, publicMed, ownerId);
    const privPath = await attach(owner, patientId, privateMed, ownerId);
    paths.push(pubPath, privPath);

    const cg = await signedInClient(cgEmail);
    const okSign = await cg.storage
      .from("documents")
      .createSignedUrl(pubPath, 60);
    expect(okSign.error).toBeNull();
    expect(okSign.data?.signedUrl).toBeTruthy();

    const denied = await cg.storage
      .from("documents")
      .createSignedUrl(privPath, 60);
    expect(denied.error).not.toBeNull(); // storage select gated by visible doc row
  });
});
