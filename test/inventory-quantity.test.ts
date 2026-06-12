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
 * Inventory quantity tracking (count on hand) + the consume/restore definer
 * RPCs. Invariants: only the owner sets the count directly; owners AND
 * caregivers consume/restore through the gated RPCs (logging is shared, §5.6);
 * viewers and non-members are rejected; the count floors at zero and an
 * untracked (null) count is a no-op.
 */

describe.skipIf(!STACK_READY)("inventory quantity + consume/restore RPCs", () => {
  const admin = STACK_READY ? adminClient() : (null as unknown as SupabaseClient);
  const stamp = Date.now();
  const ownerEmail = `inv-owner-${stamp}@example.test`;
  const caregiverEmail = `inv-cg-${stamp}@example.test`;
  const viewerEmail = `inv-viewer-${stamp}@example.test`;

  let ownerId = "";
  let caregiverId = "";
  let viewerId = "";
  let patientId = "";
  let itemId = "";

  async function quantityNow(): Promise<number | null> {
    const { data, error } = await admin
      .from("inventory_items")
      .select("quantity")
      .eq("id", itemId)
      .single();
    if (error) throw new Error(`quantityNow: ${error.message}`);
    return data.quantity == null ? null : Number(data.quantity);
  }

  beforeAll(async () => {
    ownerId = await createUser(admin, ownerEmail);
    caregiverId = await createUser(admin, caregiverEmail);
    viewerId = await createUser(admin, viewerEmail);
    patientId = await ownedPatientId(admin, ownerId);

    const { error: mErr } = await admin.from("patient_memberships").insert([
      {
        patient_id: patientId,
        user_id: caregiverId,
        role: "caregiver",
        accepted_at: new Date().toISOString(),
      },
      {
        patient_id: patientId,
        user_id: viewerId,
        role: "viewer",
        accepted_at: new Date().toISOString(),
      },
    ]);
    if (mErr) throw new Error(`memberships: ${mErr.message}`);

    const owner = await signedInClient(ownerEmail);
    const { data, error } = await owner
      .from("inventory_items")
      .insert({
        patient_id: patientId,
        category: "syringe",
        label: "1 mL test syringe",
        spec: { capacity_mL: 1 },
      })
      .select("id")
      .single();
    if (error) throw new Error(`create item: ${error.message}`);
    itemId = data.id as string;
  });

  afterAll(async () => {
    if (!STACK_READY) return;
    for (const uid of [ownerId, caregiverId, viewerId]) {
      if (uid) await admin.auth.admin.deleteUser(uid);
    }
  });

  it("owner sets the count; caregiver's direct update is filtered by RLS", async () => {
    const owner = await signedInClient(ownerEmail);
    const { error } = await owner
      .from("inventory_items")
      .update({ quantity: 5, quantity_set_at: new Date().toISOString() })
      .eq("id", itemId);
    expect(error).toBeNull();
    expect(await quantityNow()).toBe(5);

    const cg = await signedInClient(caregiverEmail);
    const { error: cgErr, count } = await cg
      .from("inventory_items")
      .update({ quantity: 999 }, { count: "exact" })
      .eq("id", itemId);
    expect(cgErr).toBeNull();
    expect(count).toBe(0); // silently filtered — owner-only write
    expect(await quantityNow()).toBe(5);
  });

  it("caregiver consumes one via the RPC (logging is a shared action)", async () => {
    const cg = await signedInClient(caregiverEmail);
    const { error } = await cg.rpc("consume_inventory_item", { p_item_id: itemId });
    expect(error).toBeNull();
    expect(await quantityNow()).toBe(4);
  });

  it("restore puts one back", async () => {
    const cg = await signedInClient(caregiverEmail);
    const { error } = await cg.rpc("restore_inventory_item", { p_item_id: itemId });
    expect(error).toBeNull();
    expect(await quantityNow()).toBe(5);
  });

  it("the count floors at zero", async () => {
    const owner = await signedInClient(ownerEmail);
    await owner
      .from("inventory_items")
      .update({ quantity: 0, quantity_set_at: new Date().toISOString() })
      .eq("id", itemId);

    const { error } = await owner.rpc("consume_inventory_item", { p_item_id: itemId });
    expect(error).toBeNull();
    expect(await quantityNow()).toBe(0);
  });

  it("an untracked (null) count is a no-op for consume and restore", async () => {
    const owner = await signedInClient(ownerEmail);
    await owner
      .from("inventory_items")
      .update({ quantity: null, quantity_set_at: null })
      .eq("id", itemId);

    await owner.rpc("consume_inventory_item", { p_item_id: itemId });
    await owner.rpc("restore_inventory_item", { p_item_id: itemId });
    expect(await quantityNow()).toBeNull();
  });

  it("a viewer is rejected by the RPC gate", async () => {
    const viewer = await signedInClient(viewerEmail);
    const { error } = await viewer.rpc("consume_inventory_item", { p_item_id: itemId });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("not authorized");
  });

  it("negative counts are rejected by the CHECK constraint", async () => {
    const owner = await signedInClient(ownerEmail);
    const { error } = await owner
      .from("inventory_items")
      .update({ quantity: -1 })
      .eq("id", itemId);
    expect(error).not.toBeNull();
  });
});
