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

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Upsert one field (or the note) of the patient's single daily diary entry for
 * a given local day — the calendar's tap-through "Diary" twisty (PRD §5.9).
 * Optimistic on the client; no redirect. Owner+caregiver. Read-merge-write so a
 * partial-index ON CONFLICT isn't needed.
 */
async function upsertDailyDiary(
  formData: FormData,
  apply: (current: Record<string, unknown>) => {
    field_values?: Record<string, unknown>;
    note?: string | null;
  }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const active = await getActivePatient(supabase);
  if (!active || (active.role !== "owner" && active.role !== "caregiver")) return;

  const day = str(formData, "day_date");
  if (!DAY_RE.test(day)) return;

  const { data: existing } = await supabase
    .from("diary_entries")
    .select("id, field_values, note")
    .eq("patient_id", active.id)
    .eq("entry_date", day)
    .maybeSingle();

  const current = (existing?.field_values as Record<string, unknown>) ?? {};
  const patch = apply(current);

  if (existing) {
    await supabase
      .from("diary_entries")
      .update({
        ...(patch.field_values ? { field_values: patch.field_values } : {}),
        ...("note" in patch ? { note: patch.note } : {}),
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("diary_entries").insert({
      patient_id: active.id,
      entry_date: day,
      entry_at: new Date(`${day}T12:00:00`).toISOString(),
      field_values: patch.field_values ?? {},
      note: "note" in patch ? patch.note : null,
      logged_by_user_id: user.id,
    });
  }

  revalidatePath("/dashboard");
  revalidatePath("/diary");
  const path = str(formData, "path");
  if (path) revalidatePath(path);
}

export async function quickSaveDiaryField(formData: FormData) {
  const fieldId = str(formData, "field_id");
  if (!fieldId) return;
  let value: unknown = null;
  const raw = str(formData, "value_json");
  if (raw) {
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
  }
  await upsertDailyDiary(formData, (current) => {
    const next = { ...current };
    // null / empty array / empty string clears the answer.
    const cleared =
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (cleared) delete next[fieldId];
    else next[fieldId] = value;
    return { field_values: next };
  });
}

export async function saveDiaryNote(formData: FormData) {
  const note = str(formData, "note");
  await upsertDailyDiary(formData, () => ({ note: note || null }));
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
