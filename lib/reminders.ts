import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushNotification, type PushSubscription } from "@/lib/push";
import { sendSms } from "@/lib/sms";
import { escalationDedupeKey } from "@/lib/notifications";
import { createNotification } from "@/lib/notifications-server";
import { isFrequency } from "@/lib/types";
import { occurrencesInWindow, frequencyIntervalMs } from "@/lib/schedule";

// Reminders engine (PRD §5.5, §13.12). Schedule generation, delivery, and
// notification action handling. Never gamifies dose-taking (hard rule #14).

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

// ── Schedule generation ────────────────────────────────────────────────────

export class ReminderScheduleError extends Error {
  constructor() { super("Could not refresh the reminder schedule."); this.name = "ReminderScheduleError"; }
}

/** Called only after a successful owner-authorized regimen save. Existing
 * delivered reminders remain history; unsent ones must reflect the new plan. */
export async function refreshMedicationReminders(medicationId: string, reset = true): Promise<void> {
  const admin = createAdminClient();
  const { data: schedule, error } = await admin.from("dose_schedules")
    .select("id").eq("medication_id", medicationId).maybeSingle();
  if (error) throw new ReminderScheduleError();
  if (!schedule) return; // Choosing a calendar does not opt the user into notifications.
  if (!reset) { await generateReminders(schedule.id); return; }
  const { error: removeError } = await admin.from("dose_reminders")
    .delete().eq("schedule_id", schedule.id).eq("status", "pending");
  if (removeError) throw new ReminderScheduleError();
  const now = new Date().toISOString();
  const { error: resetError } = await admin.from("dose_schedules")
    .update({ next_due_at: now, generated_through: now }).eq("id", schedule.id);
  if (resetError) throw new ReminderScheduleError();
  await generateReminders(schedule.id);
}

/**
 * Generate dose_reminders for a medication's schedule, looking ahead
 * `lookAheadDays` from now. Idempotent: skips times already covered.
 */
export async function generateReminders(
  scheduleId: string,
  lookAheadDays: number = 7
): Promise<number> {
  const admin = createAdminClient();

  // Load the schedule.
  const { data: schedule, error: scheduleError } = await admin
    .from("dose_schedules")
    .select("id, medication_id, patient_id, next_due_at, generated_through, consolidation_window_min")
    .eq("id", scheduleId)
    .single();
  if (scheduleError) throw new ReminderScheduleError();
  if (!schedule) return 0;

  // Load the active chosen regimen for frequency.
  const { data: regimen, error: regimenError } = await admin
    .from("chosen_regimens")
    .select("frequency, created_at")
    .eq("medication_id", schedule.medication_id)
    .eq("active", true)
    .single();
  if (regimenError) throw new ReminderScheduleError();
  if (!regimen) return 0;

  const freq = regimen.frequency;
  if (!isFrequency(freq) || freq.type === "as_needed") return 0;

  const now = Date.now();
  const endMs = now + lookAheadDays * MS_PER_DAY;
  // Reconcile the upcoming window against existing rows instead of trusting
  // only the high-water mark: a failed insert/reset can be retried safely.
  const startMs = now;

  // Determine recipient: the patient owner.
  const { data: membership } = await admin
    .from("patient_memberships")
    .select("user_id")
    .eq("patient_id", schedule.patient_id)
    .eq("role", "owner")
    .single();
  if (!membership) throw new ReminderScheduleError();

  const recipientId = membership.user_id as string;

  // Check if they have a push subscription.
  const { data: pushSub } = await admin
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", recipientId)
    .limit(1)
    .maybeSingle();

  const channel = pushSub ? "push" : "sms";

  // Use the same named-day/DST rules as the calendar and PK projections.
  const occurrences = occurrencesInWindow(freq,
    freq.type === "weekly" ? new Date(regimen.created_at).getTime() : new Date(schedule.next_due_at).getTime(),
    startMs, endMs);
  const { data: existing, error: existingError } = await admin.from("dose_reminders")
    .select("due_at").eq("schedule_id", scheduleId)
    .gte("due_at", new Date(startMs).toISOString()).lt("due_at", new Date(endMs).toISOString());
  if (existingError) throw new ReminderScheduleError();
  const already = new Set((existing ?? []).map((r) => new Date(r.due_at).getTime()));
  const rows = occurrences.filter((ms) => !already.has(ms)).map((ms) => ({
    schedule_id: scheduleId, medication_id: schedule.medication_id,
    patient_id: schedule.patient_id, due_at: new Date(ms).toISOString(),
    channel, recipient_user_id: recipientId,
  }));
  if (rows.length > 0) {
    const { error } = await admin.from("dose_reminders").insert(rows);
    if (error) throw new ReminderScheduleError();
  }
  // Retain a real occurrence as the phase anchor for interval schedules.
  const anchor = new Date(schedule.next_due_at).getTime();
  const interval = frequencyIntervalMs(freq);
  const next = interval
    ? anchor + Math.ceil((endMs - anchor) / interval) * interval
    : occurrencesInWindow(freq, anchor, endMs, endMs + 8 * MS_PER_DAY)[0];
  const { error: updateError } = await admin.from("dose_schedules").update({
    generated_through: new Date(endMs).toISOString(),
    next_due_at: new Date(next ?? endMs).toISOString(),
  }).eq("id", scheduleId);
  if (updateError) throw new ReminderScheduleError();

  return rows.length;
}

// ── Sending ────────────────────────────────────────────────────────────────

/**
 * Send a single pending reminder via its configured channel.
 * Updates status to 'sent'. Returns true on success.
 */
export async function sendReminder(reminderId: string): Promise<boolean> {
  const admin = createAdminClient();

  const { data: reminder } = await admin
    .from("dose_reminders")
    .select("id, medication_id, channel, recipient_user_id, status")
    .eq("id", reminderId)
    .single();

  if (!reminder || reminder.status !== "pending") return false;

  // Load medication display name (not a health value — just the name for the notification).
  const { data: med } = await admin
    .from("medications")
    .select("display_name")
    .eq("id", reminder.medication_id)
    .single();
  const medName = (med?.display_name as string) ?? "your medication";

  const payload = {
    title: "Dose reminder",
    body: `Time for ${medName}`,
    url: `/medications/${reminder.medication_id}`,
  };

  let success = false;

  if (reminder.channel === "push") {
    // Load the user's push subscription.
    const { data: sub } = await admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", reminder.recipient_user_id)
      .limit(1)
      .single();

    if (sub) {
      success = await sendPushNotification(
        sub as unknown as PushSubscription,
        payload
      );
      // If subscription expired, clean it up.
      if (!success) {
        await admin
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", sub.endpoint);
      }
    }
  } else {
    // SMS — load the user's phone number (future: stored on users table).
    // For now, SMS sending is a placeholder until phone numbers are collected.
    // The infrastructure is ready; the user profile field comes later.
    success = false;
  }

  if (success) {
    await admin
      .from("dose_reminders")
      .update({ status: "sent" })
      .eq("id", reminderId);
  }

  return success;
}

/**
 * Check for escalation: if a sent reminder hasn't been acted on within the
 * schedule's escalation_delay_min, notify the designated caregiver (§5.5).
 * Called by the cron send endpoint after sending.
 */
export async function checkEscalations(): Promise<number> {
  const admin = createAdminClient();
  const now = Date.now();
  let escalated = 0;

  // Find sent reminders past their escalation window.
  const { data: schedules } = await admin
    .from("dose_schedules")
    .select("id, medication_id, patient_id, escalation_delay_min, escalation_user_id")
    .not("escalation_delay_min", "is", null)
    .not("escalation_user_id", "is", null);

  for (const schedule of schedules ?? []) {
    const delayMs = (schedule.escalation_delay_min as number) * 60_000;
    const cutoff = new Date(now - delayMs).toISOString();

    // Find sent-but-unacted reminders past the escalation window.
    const { data: overdue } = await admin
      .from("dose_reminders")
      .select("id, medication_id, due_at")
      .eq("schedule_id", schedule.id)
      .eq("status", "sent")
      .lte("due_at", cutoff);

    if (!overdue || overdue.length === 0) continue;

    // Load medication name for the notification.
    const { data: med } = await admin
      .from("medications")
      .select("display_name")
      .eq("id", schedule.medication_id)
      .single();
    const medName = (med?.display_name as string) ?? "a medication";

    // Notify the escalation caregiver on every device they registered — a
    // caregiver's phone and tablet are both valid destinations.
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", schedule.escalation_user_id);
    for (const sub of subs ?? []) {
      await sendPushNotification(sub as unknown as PushSubscription, {
        title: "Dose not logged",
        body: `${medName} was due and hasn't been logged yet.`,
        url: `/medications/${schedule.medication_id}`,
      });
    }

    // Leave a factual in-app record too, so the event survives a dismissed
    // push. Structural dedupe: re-runs of the cron no-op on the same batch.
    const earliestDue = overdue
      .map((r) => r.due_at as string)
      .sort()[0];
    await createNotification(admin, {
      patient_id: schedule.patient_id as string,
      type: "dose_escalation",
      severity: "info",
      medication_id: schedule.medication_id as string,
      inventory_item_id: null,
      report_summary_id: null,
      payload: { medName },
      dedupe_key: escalationDedupeKey(schedule.id as string, earliestDue),
    });

    // Mark these reminders as missed.
    const overdueIds = overdue.map((r) => r.id as string);
    await admin
      .from("dose_reminders")
      .update({ status: "missed" })
      .in("id", overdueIds);

    escalated += overdue.length;
  }

  return escalated;
}

// ── Action handling ────────────────────────────────────────────────────────

/**
 * Handle a user's action on a reminder: Taken, Snooze, or Skip (PRD §5.5).
 * Creates a dose_log for Taken/Skip, reschedules for Snooze.
 */
export async function handleReminderAction(
  reminderId: string,
  action: "taken" | "snoozed" | "skipped",
  userId: string
): Promise<void> {
  const admin = createAdminClient();

  const { data: reminder } = await admin
    .from("dose_reminders")
    .select("id, medication_id, patient_id, due_at, schedule_id")
    .eq("id", reminderId)
    .single();

  if (!reminder) return;

  const now = new Date().toISOString();

  if (action === "snoozed") {
    // Push due_at forward by 15 minutes, reset to pending.
    const newDue = new Date(
      new Date(reminder.due_at as string).getTime() + 15 * 60_000
    ).toISOString();

    await admin
      .from("dose_reminders")
      .update({
        due_at: newDue,
        status: "pending",
        action_taken: "snoozed",
        action_at: now,
      })
      .eq("id", reminderId);
    return;
  }

  // Taken or Skipped → create a dose_log.
  if (action === "taken") {
    // Load the chosen regimen for the dose amount/unit.
    const { data: regimen } = await admin
      .from("chosen_regimens")
      .select("dose_amount, dose_unit, route")
      .eq("medication_id", reminder.medication_id)
      .eq("active", true)
      .single();

    if (regimen) {
      await admin.from("dose_logs").insert({
        medication_id: reminder.medication_id,
        patient_id: reminder.patient_id,
        event_type: "taken",
        scheduled_for: reminder.due_at,
        logged_at: now,
        amount: regimen.dose_amount,
        unit: regimen.dose_unit,
        route_taken: regimen.route,
        source: "reminder_action",
        logged_by_user_id: userId,
      });
    }
  } else {
    // Skipped.
    await admin.from("dose_logs").insert({
      medication_id: reminder.medication_id,
      patient_id: reminder.patient_id,
      event_type: "skipped",
      scheduled_for: reminder.due_at,
      logged_at: now,
      amount: null,
      unit: null,
      source: "reminder_action",
      logged_by_user_id: userId,
    });
  }

  await admin
    .from("dose_reminders")
    .update({
      status: "acted",
      action_taken: action,
      action_at: now,
    })
    .eq("id", reminderId);
}
