import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushNotification, type PushSubscription } from "@/lib/push";
import { sendSms } from "@/lib/sms";
import type { Frequency } from "@/lib/types";

// Reminders engine (PRD §5.5, §13.12). Schedule generation, delivery, and
// notification action handling. Never gamifies dose-taking (hard rule #14).

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

// ── Schedule generation ────────────────────────────────────────────────────

/** Convert a Frequency to an interval in ms. Returns null for as_needed. */
function frequencyToIntervalMs(freq: Frequency): number | null {
  if (freq.type === "as_needed") return null;
  if (freq.type === "every") {
    const multiplier: Record<string, number> = {
      hour: MS_PER_HOUR,
      day: MS_PER_DAY,
      week: MS_PER_DAY * 7,
      month: MS_PER_DAY * 30,
    };
    return freq.interval * (multiplier[freq.unit] ?? MS_PER_DAY);
  }
  if (freq.type === "times_per") {
    const periodMs = freq.period === "week" ? MS_PER_DAY * 7 : MS_PER_DAY;
    return periodMs / freq.count;
  }
  return null;
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
  const { data: schedule } = await admin
    .from("dose_schedules")
    .select("id, medication_id, patient_id, next_due_at, generated_through, consolidation_window_min")
    .eq("id", scheduleId)
    .single();
  if (!schedule) return 0;

  // Load the active chosen regimen for frequency.
  const { data: regimen } = await admin
    .from("chosen_regimens")
    .select("frequency")
    .eq("medication_id", schedule.medication_id)
    .eq("active", true)
    .single();
  if (!regimen) return 0;

  const freq = regimen.frequency as unknown as Frequency;
  const intervalMs = frequencyToIntervalMs(freq);
  if (!intervalMs) return 0; // as_needed — no scheduled reminders

  const now = Date.now();
  const endMs = now + lookAheadDays * MS_PER_DAY;
  const generatedThroughMs = new Date(schedule.generated_through as string).getTime();

  // Start from the later of next_due_at or generated_through.
  let cursor = Math.max(
    new Date(schedule.next_due_at as string).getTime(),
    generatedThroughMs
  );

  // Determine recipient: the patient owner.
  const { data: membership } = await admin
    .from("patient_memberships")
    .select("user_id")
    .eq("patient_id", schedule.patient_id)
    .eq("role", "owner")
    .single();
  if (!membership) return 0;

  const recipientId = membership.user_id as string;

  // Check if they have a push subscription.
  const { data: pushSub } = await admin
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", recipientId)
    .limit(1)
    .maybeSingle();

  const channel = pushSub ? "push" : "sms";

  const rows = [];
  while (cursor <= endMs) {
    rows.push({
      schedule_id: scheduleId,
      medication_id: schedule.medication_id,
      patient_id: schedule.patient_id,
      due_at: new Date(cursor).toISOString(),
      channel,
      recipient_user_id: recipientId,
    });
    cursor += intervalMs;
  }

  if (rows.length > 0) {
    await admin.from("dose_reminders").insert(rows);
  }

  // Update the schedule's generated_through.
  await admin
    .from("dose_schedules")
    .update({
      generated_through: new Date(endMs).toISOString(),
      next_due_at: new Date(cursor).toISOString(),
    })
    .eq("id", scheduleId);

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
