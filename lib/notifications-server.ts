import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/log";
import { loadMedicationRunOut } from "@/lib/supply-projection";
import type { ReportData } from "@/lib/report/report-data";
import {
  ITEM_USAGE_WINDOW_DAYS,
  decideItemSupplyNotification,
  decideMedSupplyNotification,
  decideSnapshotNotifications,
  isInjectableRoute,
  type NotificationInsert,
} from "@/lib/notifications";

// Server half of the notifications feature: the event-hook evaluators
// (post-dose-log, post-snapshot), persistence through the service-role client,
// and the unread count for the nav badge. All DECISIONS are pure functions in
// lib/notifications.ts; this file only loads data and writes results.
//
// Every evaluator is best-effort: callers invoke it inside try/catch AFTER the
// user's write succeeded — a notification failure must never break a dose log
// or a snapshot. Failure logging carries ids only (hard rule #12).

/**
 * Idempotent insert through the service-role client (the table has no client
 * INSERT policy — system-generated rows must not be forgeable). A dedupe-key
 * collision is silently ignored: that's the anti-overwhelm mechanism working.
 */
export async function createNotification(
  admin: SupabaseClient,
  insert: NotificationInsert
): Promise<void> {
  const { error } = await admin
    .from("notifications")
    .upsert(insert, { onConflict: "patient_id,dedupe_key", ignoreDuplicates: true });
  if (error) {
    logError("notifications", "notification insert failed", error, {
      type: insert.type,
      patientId: insert.patient_id,
    });
  }
}

type MedForEvaluation = {
  id: string;
  patient_id: string;
  display_name: string;
  single_use: boolean;
  archived: boolean;
  syringe_id: string | null;
  chosen_regimens:
    | {
        dose_amount: string;
        dose_unit: string;
        route: string | null;
        frequency: unknown;
        active: boolean;
      }[]
    | null;
  delivery_forms:
    | {
        id: string;
        package_count: string | null;
        package_unit: string | null;
        concentration: unknown;
        created_at: string;
      }[]
    | null;
};

/**
 * Post-dose-log evaluation: decrement the linked syringe for an injection, and
 * create low-supply notifications for the medication and the syringe when the
 * projection crosses the threshold. Reads run on the caller's RLS client;
 * writes go through the definer RPC (syringe) and service-role (notifications).
 */
export async function onDoseLogged(opts: {
  supabase: SupabaseClient;
  medicationId: string;
  /** route taken on this log, when the caller knows it (falls back to the
   *  active regimen's route). */
  route?: string | null;
  admin?: SupabaseClient;
  now?: number;
}): Promise<void> {
  const now = opts.now ?? Date.now();
  const { data } = await opts.supabase
    .from("medications")
    .select(
      "id, patient_id, display_name, single_use, archived, syringe_id, " +
        "chosen_regimens(dose_amount, dose_unit, route, frequency, active), " +
        "delivery_forms(id, package_count, package_unit, concentration, created_at)"
    )
    .eq("id", opts.medicationId)
    .maybeSingle();
  const med = data as MedForEvaluation | null;
  if (!med || med.single_use || med.archived) return;

  const chosen = (med.chosen_regimens ?? []).find((c) => c.active) ?? null;
  const route = opts.route ?? chosen?.route ?? null;

  // One syringe per injection: decrement the linked item's count (a no-op when
  // the owner doesn't track a count). The definer RPC enforces the role gate.
  const usedSyringe = isInjectableRoute(route) && med.syringe_id != null;
  if (usedSyringe) {
    await opts.supabase.rpc("consume_inventory_item", { p_item_id: med.syringe_id });
  }

  const admin = opts.admin ?? createAdminClient();

  // Medication run-out, projected from the newest fill.
  const delivery =
    [...(med.delivery_forms ?? [])].sort((x, y) =>
      y.created_at.localeCompare(x.created_at)
    )[0] ?? null;
  if (delivery) {
    const runOut = await loadMedicationRunOut(opts.supabase, med.id, delivery, chosen, now);
    const insert = decideMedSupplyNotification({
      patientId: med.patient_id,
      medicationId: med.id,
      deliveryFormId: delivery.id,
      medName: med.display_name,
      runOut,
    });
    if (insert) await createNotification(admin, insert);
  }

  // Syringe run-out, from the trailing usage rate across every medication that
  // uses this item.
  if (usedSyringe) {
    const { data: item } = await opts.supabase
      .from("inventory_items")
      .select("id, patient_id, label, quantity, quantity_set_at, archived")
      .eq("id", med.syringe_id as string)
      .maybeSingle();
    if (item && !item.archived && item.quantity != null) {
      const { data: itemMeds } = await opts.supabase
        .from("medications")
        .select("id")
        .eq("syringe_id", item.id);
      const medIds = (itemMeds ?? []).map((m) => m.id as string);
      let usageCount = 0;
      if (medIds.length > 0) {
        const since = new Date(now - ITEM_USAGE_WINDOW_DAYS * 86_400_000).toISOString();
        const { count } = await opts.supabase
          .from("dose_logs")
          .select("id", { count: "exact", head: true })
          .in("medication_id", medIds)
          .in("event_type", ["taken", "prn"])
          .gte("logged_at", since);
        usageCount = count ?? 0;
      }
      const insert = decideItemSupplyNotification({
        patientId: item.patient_id as string,
        itemId: item.id as string,
        label: item.label as string,
        quantity: Number(item.quantity),
        quantitySetAt: (item.quantity_set_at as string | null) ?? null,
        usageCount,
        now,
      });
      if (insert) await createNotification(admin, insert);
    }
  }
}

/**
 * Inverse of the syringe decrement when a logged dose is removed. Best-effort
 * symmetry — the caller passes the deleted log's fields (read before delete).
 */
export async function onDoseLogDeleted(opts: {
  supabase: SupabaseClient;
  medicationId: string;
  eventType: string | null;
  routeTaken: string | null;
}): Promise<void> {
  if (opts.eventType !== "taken" && opts.eventType !== "prn") return;
  const { data: med } = await opts.supabase
    .from("medications")
    .select("syringe_id, chosen_regimens(route, active)")
    .eq("id", opts.medicationId)
    .maybeSingle();
  if (!med?.syringe_id) return;
  const chosen =
    ((med.chosen_regimens ?? []) as { route: string | null; active: boolean }[]).find(
      (c) => c.active
    ) ?? null;
  const route = opts.routeTaken ?? chosen?.route ?? null;
  if (!isInjectableRoute(route)) return;
  await opts.supabase.rpc("restore_inventory_item", { p_item_id: med.syringe_id });
}

/**
 * Post-snapshot evaluation: turn the snapshot's DETERMINISTIC findings into
 * notifications — curated interactions (serious, or caution with a logged
 * substance) and doses above the regimen on record. Never reads the LLM
 * narrative (rules #8/#9).
 */
export async function onSnapshotGenerated(opts: {
  patientId: string;
  reportSummaryId: string | null;
  data: ReportData;
  admin?: SupabaseClient;
}): Promise<void> {
  const medsByDrugId = new Map<string, { id: string; isPrivate: boolean }>();
  const medById = new Map<string, { name: string }>();
  for (const m of opts.data.rows.medications) {
    medById.set(m.id, { name: m.display_name });
    if (m.canonical_drug_id && !medsByDrugId.has(m.canonical_drug_id)) {
      medsByDrugId.set(m.canonical_drug_id, { id: m.id, isPrivate: !!m.is_private });
    }
  }

  const overDose: Parameters<typeof decideSnapshotNotifications>[0]["overDose"] = [];
  for (const [medicationId, od] of opts.data.medOverDose) {
    const latest = od.examples[od.examples.length - 1];
    if (!latest) continue;
    overDose.push({
      medicationId,
      medName: medById.get(medicationId)?.name ?? "a medication",
      date: latest.date,
      loggedLabel: latest.loggedLabel,
      prescribedLabel: latest.prescribedLabel,
    });
  }

  const inserts = decideSnapshotNotifications({
    patientId: opts.patientId,
    reportSummaryId: opts.reportSummaryId,
    interactions: opts.data.facts.interactions,
    medsByDrugId,
    overDose,
  });
  if (inserts.length === 0) return;

  const admin = opts.admin ?? createAdminClient();
  for (const insert of inserts) {
    await createNotification(admin, insert);
  }
}

// ── Reads (page + badge) ─────────────────────────────────────────────────────

/**
 * Unread count for the nav dot: the caller's visible notifications (RLS
 * applies membership + medication privacy) minus their own read marks. Capped —
 * the dot only needs "any unread"; the page shows the real list.
 */
export async function getUnreadNotificationCount(
  supabase: SupabaseClient,
  patientId: string
): Promise<number> {
  const { data: notifs } = await supabase
    .from("notifications")
    .select("id")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(100);
  const ids = (notifs ?? []).map((r) => r.id as string);
  if (ids.length === 0) return 0;

  const { data: reads } = await supabase
    .from("notification_reads")
    .select("notification_id")
    .in("notification_id", ids);
  const read = new Set((reads ?? []).map((r) => r.notification_id as string));
  return ids.filter((id) => !read.has(id)).length;
}
