"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";

function str(fd: FormData, key: string): string {
  return (fd.get(key) as string | null)?.trim() ?? "";
}

/**
 * Save a diary entry (PRD §5.9). Field values are extracted from form data
 * keys prefixed with "field_" (e.g. field_<uuid>=value). Can optionally
 * attach to a dose log.
 */
export async function saveDiaryEntry(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active) redirect("/dashboard");

  const canLog = active.role === "owner" || active.role === "caregiver";
  if (!canLog) redirect("/dashboard");

  const attachedDoseLogId = str(formData, "attached_dose_log_id") || null;
  const note = str(formData, "note") || null;
  const returnTo = str(formData, "return_to") || "/diary";

  // Extract field values from "field_<id>" form keys.
  const fieldValues: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("field_") && typeof value === "string") {
      const fieldId = key.slice(6); // strip "field_" prefix
      const trimmed = value.trim();
      if (trimmed) {
        // Try to parse numbers for numeric fields.
        const n = Number(trimmed);
        fieldValues[fieldId] = Number.isFinite(n) ? n : trimmed;
      }
    }
  }

  // Handle boolean fields (checkboxes only send when checked).
  for (const [key] of formData.entries()) {
    if (key.startsWith("bool_field_")) {
      const fieldId = key.slice(11);
      fieldValues[fieldId] = true;
    }
  }

  if (Object.keys(fieldValues).length === 0 && !note) {
    redirect(`${returnTo}?error=Nothing+to+save`);
  }

  const { error } = await supabase.from("diary_entries").insert({
    patient_id: active.id,
    field_values: fieldValues,
    attached_dose_log_id: attachedDoseLogId,
    note,
    logged_by_user_id: user.id,
  });

  if (error) {
    redirect(`${returnTo}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(returnTo);
  redirect(returnTo);
}

export async function deleteDiaryEntry(formData: FormData) {
  const supabase = await createClient();
  const entryId = str(formData, "entry_id");
  const returnTo = str(formData, "return_to") || "/diary";

  if (!entryId) redirect(returnTo);

  const { error } = await supabase
    .from("diary_entries")
    .delete()
    .eq("id", entryId);

  if (error) {
    redirect(`${returnTo}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(returnTo);
  redirect(returnTo);
}
