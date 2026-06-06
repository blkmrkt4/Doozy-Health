"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePatient } from "@/lib/active-patient";
import {
  DOCUMENTS_BUCKET,
  MAX_DOCUMENT_BYTES,
  extForMime,
  isAllowedMime,
} from "@/lib/documents";
import {
  extractSyringe,
  writeExtractionDeltas,
  type ExtractedField,
} from "@/lib/extraction";

// Syringe inventory actions (PRD §5.1, §5.6). Owner-only writes. A syringe is
// supplies on hand, not a medication. American English.

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function failNewSyringe(message: string): never {
  redirect(`/inventory/new?error=${encodeURIComponent(message)}`);
}

/** Build the spec jsonb from confirmed/manual fields. */
function buildSpec(formData: FormData): Record<string, unknown> {
  const spec: Record<string, unknown> = {};
  const cap = Number(str(formData, "capacity_ml"));
  if (str(formData, "capacity_ml") && Number.isFinite(cap) && cap > 0) {
    spec.capacity_mL = cap;
  }
  const gauge = Number(str(formData, "needle_gauge"));
  if (str(formData, "needle_gauge") && Number.isFinite(gauge) && gauge > 0) {
    spec.needle_gauge = gauge;
  }
  const len = Number(str(formData, "needle_length_in"));
  if (str(formData, "needle_length_in") && Number.isFinite(len) && len > 0) {
    spec.needle_length_in = len;
  }
  const markings = str(formData, "unit_markings");
  if (markings) spec.unit_markings = markings;
  return spec;
}

function defaultLabel(spec: Record<string, unknown>): string {
  const parts: string[] = [];
  if (spec.capacity_mL) parts.push(`${spec.capacity_mL} mL`);
  if (spec.needle_gauge) parts.push(`${spec.needle_gauge}G`);
  return parts.length ? `${parts.join(" · ")} syringe` : "Syringe";
}

async function requireOwner() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const active = await getActivePatient(supabase);
  if (!active) failNewSyringe("No active patient.");
  if (active.role !== "owner") {
    failNewSyringe("Only the patient owner can manage inventory.");
  }
  return { supabase, user, active };
}

/** Manual create (no photo, or with an already-uploaded photo_document_id). */
export async function createSyringe(formData: FormData) {
  const { supabase, active } = await requireOwner();
  const spec = buildSpec(formData);
  const label = str(formData, "label") || defaultLabel(spec);
  const photoDocId = str(formData, "photo_document_id") || null;

  const { error } = await supabase.from("inventory_items").insert({
    patient_id: active.id,
    category: "syringe",
    label,
    spec,
    photo_document_id: photoDocId,
  });
  if (error) failNewSyringe(`Could not save the syringe: ${error.message}`);

  revalidatePath("/dashboard");
  redirect(str(formData, "return_to") || "/dashboard");
}

/** Upload a syringe packaging photo and run extraction, then review. */
export async function uploadAndExtractSyringe(formData: FormData) {
  const { supabase, user, active } = await requireOwner();

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    failNewSyringe("Choose a photo to scan.");
  }
  if (!isAllowedMime(file.type) || file.type === "application/pdf") {
    failNewSyringe("Please use an image file (JPEG, PNG, or HEIC).");
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    failNewSyringe("File is larger than the 25 MB limit.");
  }

  const docId = crypto.randomUUID();
  const path = `${active.id}/${docId}.${extForMime(file.type)}`;

  const { error: upErr } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) failNewSyringe(`Upload failed: ${upErr.message}`);

  const { error: rowErr } = await supabase.from("documents").insert({
    id: docId,
    patient_id: active.id,
    storage_path: path,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    document_type: "syringe_packaging",
    uploaded_by: user.id,
  });
  if (rowErr) {
    await createAdminClient().storage.from(DOCUMENTS_BUCKET).remove([path]);
    failNewSyringe(`Could not save the document: ${rowErr.message}`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = `data:${file.type};base64,${buffer.toString("base64")}`;

  const result = await extractSyringe(docId, base64, "insulin, tuberculin, Luer-lock, Luer-slip");
  if (!result.ok) {
    // Still let the user review/fill manually on the extract screen.
    redirect(
      `/inventory/new/extract?doc=${docId}&error=${encodeURIComponent(result.error)}`
    );
  }

  redirect(`/inventory/new/extract?doc=${docId}`);
}

/** Confirm a reviewed syringe extraction → create the inventory item. */
export async function confirmSyringeExtraction(formData: FormData) {
  const { supabase, active } = await requireOwner();
  const docId = str(formData, "document_id");

  const spec = buildSpec(formData);
  const label = str(formData, "label") || defaultLabel(spec);

  const { data: inserted, error } = await supabase
    .from("inventory_items")
    .insert({
      patient_id: active.id,
      category: "syringe",
      label,
      spec,
      photo_document_id: docId || null,
    })
    .select("id")
    .single();
  if (error) {
    redirect(
      `/inventory/new/extract?doc=${docId}&error=${encodeURIComponent(`Could not save: ${error.message}`)}`
    );
  }
  void inserted;

  // Best-effort delta capture for extraction quality (no patient/med id, rule #10).
  try {
    const admin = createAdminClient();
    const { data: doc } = await admin
      .from("documents")
      .select("extracted_json")
      .eq("id", docId)
      .maybeSingle();
    const extraction = doc?.extracted_json as
      | Record<string, ExtractedField<unknown>>
      | null;
    if (extraction) {
      const { data: prompt } = await admin
        .from("prompts")
        .select("current_version_id")
        .eq("slug", "extract_syringe")
        .maybeSingle();
      const { data: lastLog } = await admin
        .from("llm_call_logs")
        .select("model_used")
        .eq("prompt_slug", "extract_syringe")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      await writeExtractionDeltas({
        documentId: docId || null,
        drugCanonicalName: "syringe",
        extraction,
        userValues: {
          capacity_ml: str(formData, "capacity_ml"),
          needle_gauge: str(formData, "needle_gauge"),
          needle_length_in: str(formData, "needle_length_in"),
          unit_markings: str(formData, "unit_markings"),
          manufacturer: str(formData, "manufacturer"),
          batch: str(formData, "batch"),
        },
        direction: "llm_to_user",
        promptSlug: "extract_syringe",
        promptVersionId: (prompt?.current_version_id as string) ?? "",
        modelUsed: (lastLog?.model_used as string) ?? "",
      });
    }
  } catch {
    // Delta capture is a quality signal, never blocks the save.
  }

  revalidatePath("/dashboard");
  redirect(str(formData, "return_to") || "/dashboard");
}

export async function updateSyringe(formData: FormData) {
  const { supabase } = await requireOwner();
  const id = str(formData, "syringe_id");
  if (!id) failNewSyringe("Missing syringe.");
  const spec = buildSpec(formData);
  const label = str(formData, "label") || defaultLabel(spec);

  const { error } = await supabase
    .from("inventory_items")
    .update({ label, spec })
    .eq("id", id);
  if (error) failNewSyringe(`Could not update the syringe: ${error.message}`);

  revalidatePath("/dashboard");
  redirect(str(formData, "return_to") || "/dashboard");
}

export async function archiveSyringe(formData: FormData) {
  const { supabase } = await requireOwner();
  const id = str(formData, "syringe_id");
  if (!id) failNewSyringe("Missing syringe.");

  const { error } = await supabase
    .from("inventory_items")
    .update({ archived: true })
    .eq("id", id);
  if (error) failNewSyringe(`Could not remove the syringe: ${error.message}`);

  revalidatePath("/dashboard");
  redirect(str(formData, "return_to") || "/dashboard");
}
