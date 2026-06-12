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
 * End-to-end: the post-dose-log evaluator against the real local stack.
 * A dose logged against a nearly-empty fill creates exactly ONE low-supply
 * notification (the dedupe key swallows the second log), an injectable dose
 * decrements the linked syringe, and the syringe's own projection notifies.
 */

const dailyTablet = {
  dose_amount: 1,
  dose_unit: "tablet",
  route: "oral",
  frequency: { type: "times_per", count: 1, period: "day" },
};

const weeklyInjection = {
  dose_amount: 0.5,
  dose_unit: "mL",
  route: "subcutaneous",
  frequency: { type: "every", interval: 1, unit: "day" },
};

describe.skipIf(!STACK_READY)("notifications integration (evaluators on the stack)", () => {
  const admin = STACK_READY ? adminClient() : (null as unknown as SupabaseClient);
  const stamp = Date.now();
  const ownerEmail = `notif-e2e-${stamp}@example.test`;

  let ownerId = "";
  let patientId = "";
  let owner: SupabaseClient;

  beforeAll(async () => {
    ownerId = await createUser(admin, ownerEmail);
    patientId = await ownedPatientId(admin, ownerId);
    owner = await signedInClient(ownerEmail);
  });

  afterAll(async () => {
    if (!STACK_READY) return;
    if (ownerId) await admin.auth.admin.deleteUser(ownerId);
  });

  async function createMed(
    name: string,
    regimen: Record<string, unknown>,
    delivery: Record<string, unknown>
  ): Promise<string> {
    const { data, error } = await owner.rpc("create_manual_medication", {
      p_patient_id: patientId,
      p_display_name: name,
      p_is_private: false,
      p_prescribed: regimen,
      p_delivery: delivery,
      p_chosen: regimen,
    });
    if (error) throw new Error(`createMed: ${error.message}`);
    return data as string;
  }

  async function logDose(
    medicationId: string,
    amount: number,
    unit: string,
    route: string
  ): Promise<void> {
    const { error } = await owner.from("dose_logs").insert({
      medication_id: medicationId,
      patient_id: patientId,
      event_type: "taken",
      amount,
      unit,
      route_taken: route,
      source: "manual",
      logged_by_user_id: ownerId,
    });
    if (error) throw new Error(`logDose: ${error.message}`);
  }

  async function notificationsOfType(type: string) {
    const { data, error } = await admin
      .from("notifications")
      .select("id, type, severity, medication_id, inventory_item_id, payload, dedupe_key")
      .eq("patient_id", patientId)
      .eq("type", type);
    if (error) throw new Error(`notifications: ${error.message}`);
    return data ?? [];
  }

  it("low fill + dose log → one notification; second log dedupes", async () => {
    // 5 tablets on hand at 1/day → ~4 days after one dose: under the threshold.
    const medId = await createMed("E2E Tablet", dailyTablet, {
      form_type: "pill_bottle",
      package_count: "5",
      package_unit: "tablets",
    });

    const { onDoseLogged } = await import("@/lib/notifications-server");

    await logDose(medId, 1, "tablet", "oral");
    await onDoseLogged({ supabase: owner, medicationId: medId, route: "oral", admin });

    let rows = await notificationsOfType("supply_low_medication");
    expect(rows).toHaveLength(1);
    expect(rows[0].medication_id).toBe(medId);
    expect(rows[0].severity).toBe("info");
    expect((rows[0].payload as { medName?: string }).medName).toBe("E2E Tablet");

    // Logging again re-evaluates but the fill-bucketed dedupe key swallows it.
    await logDose(medId, 1, "tablet", "oral");
    await onDoseLogged({ supabase: owner, medicationId: medId, route: "oral", admin });
    rows = await notificationsOfType("supply_low_medication");
    expect(rows).toHaveLength(1);
  });

  it("injectable dose decrements the linked syringe and projects its run-out", async () => {
    const { data: item, error: itemErr } = await owner
      .from("inventory_items")
      .insert({
        patient_id: patientId,
        category: "syringe",
        label: "E2E syringes",
        spec: { capacity_mL: 1 },
        quantity: 3,
        quantity_set_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (itemErr) throw new Error(itemErr.message);

    const medId = await createMed("E2E Injectable", weeklyInjection, {
      form_type: "vial",
      concentration: { amount: 10, unit: "mg", per_volume: 1, volume_unit: "mL" },
      package_count: "100",
      package_unit: "mL",
    });
    const { error: linkErr } = await owner
      .from("medications")
      .update({ syringe_id: item.id })
      .eq("id", medId);
    if (linkErr) throw new Error(linkErr.message);

    const { onDoseLogged } = await import("@/lib/notifications-server");
    await logDose(medId, 0.5, "mL", "subcutaneous");
    await onDoseLogged({
      supabase: owner,
      medicationId: medId,
      route: "subcutaneous",
      admin,
    });

    // One syringe consumed: 3 → 2.
    const { data: after } = await admin
      .from("inventory_items")
      .select("quantity")
      .eq("id", item.id)
      .single();
    expect(Number(after!.quantity)).toBe(2);

    // 2 left at ~1/14-day-window... one log in the window → rate 1/14 → 28 days?
    // No: usage is 1 log over 14 days → 2 ÷ (1/14) = 28 days → no notification.
    // The medication itself has 99.5 mL at 0.5/day → no notification either.
    const itemRows = await notificationsOfType("supply_low_item");
    expect(itemRows).toHaveLength(0);

    // Log daily injections to raise the usage rate: 6 more logs → rate 7/14 =
    // 0.5/day → 2 ÷ 0.5 = 4 days left → notifies once.
    for (let i = 0; i < 6; i++) {
      await logDose(medId, 0.5, "mL", "subcutaneous");
    }
    await onDoseLogged({
      supabase: owner,
      medicationId: medId,
      route: "subcutaneous",
      admin,
    });

    const itemRowsAfter = await notificationsOfType("supply_low_item");
    expect(itemRowsAfter).toHaveLength(1);
    expect(itemRowsAfter[0].inventory_item_id).toBe(item.id);
  });
});
