"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Notifications read-state actions. Read marks are PER USER (an owner reading
// must not clear a caregiver's dot) and the insert policy only allows a user's
// own marks for notifications they can currently see — so this runs on the
// caller's RLS client, never the admin client.

/**
 * Mark every notification the caller can currently see for this patient as
 * read. Fired when the notifications page mounts; idempotent (duplicate marks
 * are ignored).
 */
export async function markAllNotificationsRead(patientId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !patientId) return;

  const { data: notifs } = await supabase
    .from("notifications")
    .select("id")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(100);
  const ids = (notifs ?? []).map((r) => r.id as string);
  if (ids.length === 0) return;

  await supabase
    .from("notification_reads")
    .upsert(
      ids.map((id) => ({ notification_id: id, user_id: user.id })),
      { onConflict: "notification_id,user_id", ignoreDuplicates: true }
    );

  // Refresh the layout so the bell dot clears.
  revalidatePath("/notifications");
}
