"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { llmCall } from "@/lib/llm";

function str(fd: FormData, key: string): string {
  return (fd.get(key) as string | null)?.trim() ?? "";
}

function fail(message: string): never {
  redirect(`/settings/tracking?error=${encodeURIComponent(message)}`);
}

const VALID_TYPES = new Set([
  "number",
  "scale_1_10",
  "boolean",
  "freetext",
  "category",
]);

// ── Tracked field management ───────────────────────────────────────────────

export async function createTrackedField(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active || active.role !== "owner") fail("Only the owner can manage fields.");

  const name = str(formData, "name");
  if (!name) fail("Field name is required.");

  const fieldType = str(formData, "field_type");
  if (!VALID_TYPES.has(fieldType)) fail("Choose a valid field type.");

  const unit = str(formData, "unit") || null;

  let categoryOptions = null;
  if (fieldType === "category") {
    const raw = str(formData, "category_options");
    if (!raw) fail("Category fields need at least one option.");
    categoryOptions = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (categoryOptions.length === 0) fail("Enter at least one category option.");
  }

  // Get the next display_order.
  const { data: existing } = await supabase
    .from("tracked_fields")
    .select("display_order")
    .eq("patient_id", active.id)
    .order("display_order", { ascending: false })
    .limit(1);

  const nextOrder =
    ((existing?.[0]?.display_order as number | undefined) ?? -1) + 1;

  const { error } = await supabase.from("tracked_fields").insert({
    patient_id: active.id,
    name,
    field_type: fieldType,
    unit,
    category_options: categoryOptions,
    display_order: nextOrder,
  });

  if (error) fail(`Could not create field: ${error.message}`);

  revalidatePath("/settings/tracking");
  redirect("/settings/tracking?success=Field+created");
}

export async function updateTrackedField(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const fieldId = str(formData, "field_id");
  const active = str(formData, "active");

  if (!fieldId) fail("Missing field.");

  const updates: Record<string, unknown> = {};
  if (active === "true" || active === "false") {
    updates.active = active === "true";
  }
  const name = str(formData, "name");
  if (name) updates.name = name;

  if (Object.keys(updates).length === 0) fail("Nothing to update.");

  const { error } = await supabase
    .from("tracked_fields")
    .update(updates)
    .eq("id", fieldId);

  if (error) fail(`Could not update: ${error.message}`);

  revalidatePath("/settings/tracking");
  redirect("/settings/tracking");
}

export async function deleteTrackedField(formData: FormData) {
  const supabase = await createClient();
  const fieldId = str(formData, "field_id");
  if (!fieldId) fail("Missing field.");

  const { error } = await supabase
    .from("tracked_fields")
    .delete()
    .eq("id", fieldId);

  if (error) fail(`Could not delete: ${error.message}`);

  revalidatePath("/settings/tracking");
  redirect("/settings/tracking?success=Field+removed");
}

// ── AI suggestions ─────────────────────────────────────────────────────────

/**
 * Suggest diary fields based on the patient's medications (PRD §5.9).
 * Calls suggest_diary_fields — returns an array of field suggestions.
 */
export async function suggestFields(
  formData: FormData
): Promise<Array<{ name: string; type: string; reason: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const active = await getActivePatient(supabase);
  if (!active) return [];

  // Load medication names.
  const { data: meds } = await supabase
    .from("medications")
    .select("display_name")
    .eq("patient_id", active.id)
    .eq("archived", false);
  const medList = (meds ?? []).map((m) => m.display_name as string).join(", ");

  const concerns = str(formData, "concerns");

  const result = await llmCall("suggest_diary_fields", {
    medication_list: medList,
    user_stated_concerns: concerns,
  });

  if (!result.ok) return [];

  // Defensive parse — expect array of { name, type, reason }.
  try {
    let text = result.text
      .replace(/```(?:json)?\s*/gi, "")
      .replace(/```/g, "");
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1) return [];
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item: unknown) =>
          typeof item === "object" && item !== null && "name" in item
      )
      .map((item: Record<string, unknown>) => ({
        name: String(item.name ?? ""),
        type: String(item.type ?? "scale_1_10"),
        reason: String(item.reason ?? ""),
      }));
  } catch {
    return [];
  }
}
