"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePatient } from "@/lib/active-patient";
import {
  DOCUMENTS_BUCKET,
  MAX_DOCUMENT_BYTES,
  SIGNED_URL_TTL_SECONDS,
  extForMime,
  isAllowedMime,
  isDocumentType,
} from "@/lib/documents";
import {
  DOSE_UNITS,
  FORM_TYPES,
  FREQUENCY_PERIODS,
  FREQUENCY_UNITS,
  ROUTES,
  type Concentration,
  type DoseUnit,
  type Frequency,
  type Route,
  type SyringeSpec,
} from "@/lib/types";
import {
  extractVial,
  extractPrescription,
  normaliseDrugName,
  writeExtractionDeltas,
  type VialExtraction,
  type PrescriptionExtraction,
} from "@/lib/extraction";
import { generateReminders } from "@/lib/reminders";
import { explainInteraction } from "@/lib/interactions";

function failNew(message: string): never {
  redirect(`/medications/new?error=${encodeURIComponent(message)}`);
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function inSet<T extends string>(
  value: string,
  set: readonly T[]
): T | null {
  return (set as readonly string[]).includes(value) ? (value as T) : null;
}

// Build a Frequency from a set of prefixed form fields, e.g. prefix
// "prescribed_freq" reads prescribed_freq_type / _interval / _unit / etc.
function parseFrequency(formData: FormData, prefix: string): Frequency | null {
  const type = str(formData, `${prefix}_type`);
  if (type === "as_needed") return { type: "as_needed" };
  if (type === "every") {
    const interval = Number(str(formData, `${prefix}_interval`));
    const unit = inSet(str(formData, `${prefix}_unit`), FREQUENCY_UNITS);
    if (!Number.isFinite(interval) || interval <= 0 || !unit) return null;
    return { type: "every", interval, unit };
  }
  if (type === "times_per") {
    const count = Number(str(formData, `${prefix}_count`));
    const period = inSet(str(formData, `${prefix}_period`), FREQUENCY_PERIODS);
    if (!Number.isFinite(count) || count <= 0 || !period) return null;
    return { type: "times_per", count, period };
  }
  return null;
}

type RegimenInput = {
  dose_amount: number;
  dose_unit: DoseUnit;
  route: Route;
  frequency: Frequency;
};

function parseRegimen(
  formData: FormData,
  prefix: string,
  label: string
): RegimenInput {
  const dose_amount = Number(str(formData, `${prefix}_dose_amount`));
  if (!Number.isFinite(dose_amount) || dose_amount <= 0) {
    failNew(`Enter a ${label} dose amount greater than zero.`);
  }
  const dose_unit = inSet(str(formData, `${prefix}_dose_unit`), DOSE_UNITS);
  if (!dose_unit) failNew(`Choose a valid ${label} dose unit.`);
  const route = inSet(str(formData, `${prefix}_route`), ROUTES);
  if (!route) failNew(`Choose a valid ${label} route.`);
  const frequency = parseFrequency(formData, `${prefix}_freq`);
  if (!frequency) failNew(`Complete the ${label} frequency.`);
  return { dose_amount, dose_unit, route, frequency };
}

export async function createMedication(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Only the patient owner may add medications (PRD §5.6). The active patient
  // is validated against the membership set by getActivePatient.
  const active = await getActivePatient(supabase);
  if (!active) failNew("No active patient.");
  if (active.role !== "owner") {
    failNew("Only the patient owner can add a medication.");
  }

  const displayName = str(formData, "drug_name");
  if (!displayName) failNew("Enter the medication name.");

  // Optional: the matched reference-drug id from the typeahead. Free-text
  // entries leave it blank (PRD §4.2 keeps manual entry first-class).
  const canonicalDrugId = str(formData, "canonical_drug_id") || null;

  const isPrivate = formData.get("is_private") === "on";

  const prescribed = parseRegimen(formData, "prescribed", "prescribed");

  // Delivery form.
  const formType = inSet(str(formData, "form_type"), FORM_TYPES);
  if (!formType) failNew("Choose the delivery form.");

  // Optional concentration (e.g. 200 mg/mL for a vial).
  let concentration: Concentration | undefined;
  const concAmount = Number(str(formData, "conc_amount"));
  if (str(formData, "conc_amount") !== "" && Number.isFinite(concAmount)) {
    const concUnit = inSet(str(formData, "conc_unit"), DOSE_UNITS);
    const perVolume = Number(str(formData, "conc_per_volume") || "1");
    if (!concUnit || !Number.isFinite(perVolume) || perVolume <= 0) {
      failNew("Complete the concentration, or clear it.");
    }
    concentration = {
      amount: concAmount,
      unit: concUnit,
      per_volume: perVolume,
      volume_unit: "mL",
    };
  }

  // Optional syringe spec (injectables only; the form hides it otherwise).
  let syringeSpec: SyringeSpec | undefined;
  const capacity = Number(str(formData, "syringe_capacity_ml"));
  if (str(formData, "syringe_capacity_ml") !== "" && Number.isFinite(capacity)) {
    syringeSpec = {
      capacity_mL: capacity,
      needle_gauge: Number(str(formData, "syringe_needle_gauge")) || 0,
      needle_length_in: Number(str(formData, "syringe_needle_length_in")) || 0,
      unit_markings: str(formData, "syringe_unit_markings"),
    };
  }

  // Chosen regimen: defaults to the prescribed regimen unless the user marks
  // that they take it differently (PRD §5.3).
  const choseDiffers = formData.get("chosen_differs") === "on";
  const chosen = choseDiffers
    ? parseRegimen(formData, "chosen", "chosen")
    : prescribed;
  const reasonNote = choseDiffers ? str(formData, "chosen_reason_note") : "";

  const { data: medId, error } = await supabase.rpc(
    "create_manual_medication",
    {
      p_patient_id: active.id,
      p_display_name: displayName,
      p_is_private: isPrivate,
      p_prescribed: {
        dose_amount: prescribed.dose_amount,
        dose_unit: prescribed.dose_unit,
        route: prescribed.route,
        frequency: prescribed.frequency,
        duration_days: str(formData, "prescribed_duration_days"),
        prescriber_name: str(formData, "prescriber_name"),
      },
      p_delivery: {
        form_type: formType,
        ...(concentration ? { concentration } : {}),
        package_count: str(formData, "package_count"),
        package_unit: str(formData, "package_unit"),
        ...(syringeSpec ? { syringe_spec: syringeSpec } : {}),
        expiry_date: str(formData, "expiry_date"),
        batch: str(formData, "batch"),
        manufacturer: str(formData, "manufacturer"),
      },
      p_chosen: {
        dose_amount: chosen.dose_amount,
        dose_unit: chosen.dose_unit,
        route: chosen.route,
        frequency: chosen.frequency,
        reason_note: reasonNote,
      },
      p_canonical_drug_id: canonicalDrugId,
    }
  );

  if (error) {
    failNew(`Could not save the medication: ${error.message}`);
  }

  revalidatePath("/dashboard");
  redirect(`/medications/${medId as string}`);
}

// ── Owner controls on the detail page ───────────────────────────────────────

export async function setMedicationPrivacy(formData: FormData) {
  const supabase = await createClient();
  const id = str(formData, "medication_id");
  const makePrivate = formData.get("is_private") === "on";

  const { error } = await supabase
    .from("medications")
    .update({ is_private: makePrivate })
    .eq("id", id);

  if (error) {
    redirect(`/medications/${id}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/medications/${id}`);
  revalidatePath("/dashboard");
  redirect(`/medications/${id}`);
}

export async function archiveMedication(formData: FormData) {
  const supabase = await createClient();
  const id = str(formData, "medication_id");

  const { error } = await supabase
    .from("medications")
    .update({ archived: true })
    .eq("id", id);

  if (error) {
    redirect(`/medications/${id}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

// ── Dose logging (PRD §5.4, §4.3) ───────────────────────────────────────────

/**
 * The caller's role on a patient, used to set dose_logs.source: a caregiver's
 * log is tagged 'caregiver', an owner's manual log 'manual' (PRD §8). Returns
 * null if the caller holds no membership (RLS scopes the lookup to own rows).
 */
async function roleForPatient(
  supabase: SupabaseClient,
  patientId: string
): Promise<"owner" | "caregiver" | "viewer" | null> {
  const { data } = await supabase
    .from("patient_memberships")
    .select("role")
    .eq("patient_id", patientId)
    .maybeSingle();
  return (data?.role as "owner" | "caregiver" | "viewer") ?? null;
}

function failDose(medicationId: string, message: string): never {
  redirect(
    `/medications/${medicationId}?error=${encodeURIComponent(message)}`
  );
}

/**
 * One-tap log of the scheduled dose at the current time (the < 10s path,
 * §4.3). Amount/unit/route come from the active chosen regimen.
 */
export async function logScheduledDose(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const medicationId = str(formData, "medication_id");
  const returnTo = str(formData, "return_to") || "/dashboard";

  const { data: chosen } = await supabase
    .from("chosen_regimens")
    .select("patient_id, dose_amount, dose_unit, route")
    .eq("medication_id", medicationId)
    .eq("active", true)
    .maybeSingle();
  if (!chosen) failDose(medicationId, "No active regimen to log.");

  const role = await roleForPatient(supabase, chosen.patient_id);
  if (role !== "owner" && role !== "caregiver") {
    failDose(medicationId, "You cannot log doses for this medication.");
  }

  const { error } = await supabase.from("dose_logs").insert({
    medication_id: medicationId,
    patient_id: chosen.patient_id,
    event_type: "taken",
    amount: chosen.dose_amount, // numeric-as-string; preserves precision
    unit: chosen.dose_unit,
    route_taken: chosen.route,
    source: role === "caregiver" ? "caregiver" : "manual",
    logged_by_user_id: user.id,
  });
  if (error) failDose(medicationId, `Could not log the dose: ${error.message}`);

  revalidatePath("/dashboard");
  revalidatePath(`/medications/${medicationId}`);
  redirect(returnTo);
}

/**
 * Custom log: a different amount/time, an injection site/note, an as-needed
 * (PRN) dose, or a skip with a reason (§5.4).
 */
export async function logDose(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const medicationId = str(formData, "medication_id");
  const eventType = str(formData, "event_type");
  if (!["taken", "prn", "skipped"].includes(eventType)) {
    failDose(medicationId, "Choose what to log.");
  }

  // Resolve the patient + role from the medication (RLS-scoped).
  const { data: med } = await supabase
    .from("medications")
    .select("patient_id")
    .eq("id", medicationId)
    .maybeSingle();
  if (!med) failDose(medicationId, "Medication not found.");
  const role = await roleForPatient(supabase, med.patient_id);
  if (role !== "owner" && role !== "caregiver") {
    failDose(medicationId, "You cannot log doses for this medication.");
  }

  // When-logged: a tz-less datetime-local value, or now if blank.
  const whenRaw = str(formData, "logged_at");
  let loggedAt: string | undefined;
  if (whenRaw) {
    const d = new Date(whenRaw);
    if (Number.isNaN(d.getTime())) failDose(medicationId, "Invalid time.");
    loggedAt = d.toISOString();
  }

  const source = role === "caregiver" ? "caregiver" : "manual";
  const note = str(formData, "note") || null;
  const site = str(formData, "site") || null;

  const row: Record<string, unknown> = {
    medication_id: medicationId,
    patient_id: med.patient_id,
    event_type: eventType,
    source,
    logged_by_user_id: user.id,
    site,
    note,
  };
  if (loggedAt) row.logged_at = loggedAt;

  if (eventType === "skipped") {
    // A skip carries a reason but no amount/unit (the CHECK enforces this).
    row.note = str(formData, "skip_reason") || note;
    row.amount = null;
    row.unit = null;
  } else {
    const amountRaw = str(formData, "amount");
    const amount = Number(amountRaw);
    if (!amountRaw || !Number.isFinite(amount) || amount <= 0) {
      failDose(medicationId, "Enter a dose amount greater than zero.");
    }
    const unit = inSet(str(formData, "unit"), DOSE_UNITS);
    if (!unit) failDose(medicationId, "Choose a valid unit.");
    const routeRaw = str(formData, "route_taken");
    const route = routeRaw ? inSet(routeRaw, ROUTES) : null;
    if (routeRaw && !route) failDose(medicationId, "Choose a valid route.");
    row.amount = amountRaw; // preserve precision (numeric-as-string)
    row.unit = unit;
    row.route_taken = route;
  }

  const { error } = await supabase.from("dose_logs").insert(row);
  if (error) failDose(medicationId, `Could not log the dose: ${error.message}`);

  revalidatePath("/dashboard");
  revalidatePath(`/medications/${medicationId}`);
  redirect(`/medications/${medicationId}`);
}

// ── Photos / documents (PRD §5.1, §13.5) ────────────────────────────────────

/**
 * Attach a photo/PDF to a medication. Stored in the private bucket under
 * <patient_id>/<doc_id>.<ext> (the doc_id is the documents row id), with a
 * documents row linking it. No extraction yet (step 8) — status stays
 * 'uploaded'. Storage + documents RLS enforce owner/caregiver write.
 */
export async function attachMedicationPhoto(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const medicationId = str(formData, "medication_id");
  const docTypeRaw = str(formData, "document_type") || "vial_photo";
  const documentType = isDocumentType(docTypeRaw) ? docTypeRaw : "other";

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    failDose(medicationId, "Choose a file to upload.");
  }
  if (!isAllowedMime(file.type)) {
    failDose(medicationId, "Unsupported file type (use JPEG, PNG, HEIC, or PDF).");
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    failDose(medicationId, "File is larger than the 25 MB limit.");
  }

  // The medication's patient scopes the storage folder + documents row.
  const { data: med } = await supabase
    .from("medications")
    .select("patient_id")
    .eq("id", medicationId)
    .maybeSingle();
  if (!med) failDose(medicationId, "Medication not found.");

  const role = await roleForPatient(supabase, med.patient_id);
  if (role !== "owner" && role !== "caregiver") {
    failDose(medicationId, "You cannot add photos for this medication.");
  }

  const docId = crypto.randomUUID();
  const path = `${med.patient_id}/${docId}.${extForMime(file.type)}`;

  const { error: upErr } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) failDose(medicationId, `Upload failed: ${upErr.message}`);

  const { error: rowErr } = await supabase.from("documents").insert({
    id: docId,
    patient_id: med.patient_id,
    storage_path: path,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    document_type: documentType,
    linked_medication_id: medicationId,
    uploaded_by: user.id,
  });
  if (rowErr) {
    // Roll back the orphaned object (service-role; storage delete is owner-only).
    await createAdminClient().storage.from(DOCUMENTS_BUCKET).remove([path]);
    failDose(medicationId, `Could not save the document: ${rowErr.message}`);
  }

  revalidatePath(`/medications/${medicationId}`);
  redirect(`/medications/${medicationId}`);
}

/** Remove a document (its row, RLS-gated to uploader/owner, then the object). */
export async function deleteDocument(formData: FormData) {
  const supabase = await createClient();
  const medicationId = str(formData, "medication_id");
  const documentId = str(formData, "document_id");

  // Read the path while it's still visible, then delete the row under RLS
  // (uploader or owner). If the row delete is denied, nothing is removed.
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) failDose(medicationId, "Document not found.");

  const { error, count } = await supabase
    .from("documents")
    .delete({ count: "exact" })
    .eq("id", documentId);
  if (error) failDose(medicationId, `Could not remove the document: ${error.message}`);
  if (!count) failDose(medicationId, "You cannot remove this document.");

  // Row gone (authorised) — remove the backing object with the service role.
  await createAdminClient()
    .storage.from(DOCUMENTS_BUCKET)
    .remove([doc.storage_path]);

  revalidatePath(`/medications/${medicationId}`);
  redirect(`/medications/${medicationId}`);
}

/** Undo a logged dose (the logger or an owner, enforced by RLS). */
export async function deleteDoseLog(formData: FormData) {
  const supabase = await createClient();
  const medicationId = str(formData, "medication_id");
  const logId = str(formData, "log_id");

  const { error } = await supabase.from("dose_logs").delete().eq("id", logId);
  if (error) failDose(medicationId, `Could not remove the log: ${error.message}`);

  revalidatePath("/dashboard");
  revalidatePath(`/medications/${medicationId}`);
  redirect(`/medications/${medicationId}`);
}

// ── AI extraction (PRD §5.2, §13.8–9) ──────────────────────────────────────

function failExtract(message: string): never {
  redirect(`/medications/new?error=${encodeURIComponent(message)}`);
}

/**
 * Upload a photo and run extraction (vial or prescription based on
 * document_type). Stores the document, runs the appropriate extraction,
 * and redirects to the review page. Does NOT write to medication tables
 * (hard rule #6 — never auto-commit an extraction).
 */
export async function uploadAndExtract(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active) failExtract("No active patient.");
  if (active.role !== "owner") failExtract("Only the patient owner can add a medication.");

  const docTypeRaw = str(formData, "document_type") || "vial_photo";
  const documentType = docTypeRaw === "prescription_scan"
    ? "prescription_scan" as const
    : "vial_photo" as const;

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    failExtract("Choose a photo to scan.");
  }
  if (!isAllowedMime(file.type) || file.type === "application/pdf") {
    failExtract("Please use an image file (JPEG, PNG, or HEIC).");
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    failExtract("File is larger than the 25 MB limit.");
  }

  // Upload the document.
  const docId = crypto.randomUUID();
  const path = `${active.id}/${docId}.${extForMime(file.type)}`;

  const { error: upErr } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) failExtract(`Upload failed: ${upErr.message}`);

  const { error: rowErr } = await supabase.from("documents").insert({
    id: docId,
    patient_id: active.id,
    storage_path: path,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    document_type: documentType,
    uploaded_by: user.id,
  });
  if (rowErr) {
    await createAdminClient().storage.from(DOCUMENTS_BUCKET).remove([path]);
    failExtract(`Could not save the document: ${rowErr.message}`);
  }

  // Convert to base64 data URL for the LLM.
  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = `data:${file.type};base64,${buffer.toString("base64")}`;

  // Gather existing medication names for context.
  const { data: meds } = await supabase
    .from("medications")
    .select("display_name")
    .eq("patient_id", active.id)
    .eq("archived", false);
  const medNames = (meds ?? []).map((m) => m.display_name as string).join(", ");

  // Run the appropriate extraction.
  const result = documentType === "prescription_scan"
    ? await extractPrescription(docId, base64, medNames)
    : await extractVial(docId, base64, medNames, "metric");

  if (!result.ok) {
    redirect(
      `/medications/new?error=${encodeURIComponent(`Extraction failed: ${result.error}`)}`
    );
  }

  // Redirect to the review page with the document ID.
  redirect(`/medications/new/extract?doc=${docId}`);
}

/**
 * Confirm an extraction: create the medication from the user-edited fields
 * and write extraction_deltas for any changed values (PRD §5.2.3).
 */
export async function confirmPhotoExtraction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active) failNew("No active patient.");
  if (active.role !== "owner") failNew("Only the patient owner can add a medication.");

  const docId = str(formData, "document_id");
  if (!docId) failNew("Missing document reference.");

  const admin = createAdminClient();

  // Load the extraction from the document.
  const { data: doc } = await admin
    .from("documents")
    .select("extracted_json, storage_path")
    .eq("id", docId)
    .single();
  if (!doc?.extracted_json) failNew("No extraction found for this document.");

  const extraction = doc.extracted_json as unknown as VialExtraction;

  // Read user-confirmed values from the form.
  const displayName = str(formData, "drug_name");
  if (!displayName) failNew("Enter the medication name.");

  const doseAmount = Number(str(formData, "dose_amount"));
  if (!Number.isFinite(doseAmount) || doseAmount <= 0) {
    failNew("Enter a valid dose amount.");
  }
  const doseUnit = inSet(str(formData, "dose_unit"), DOSE_UNITS);
  if (!doseUnit) failNew("Choose a valid dose unit.");
  const route = inSet(str(formData, "route"), ROUTES);
  if (!route) failNew("Choose a valid route.");
  const formType = inSet(str(formData, "form_type"), FORM_TYPES) ?? "vial";

  // Build optional concentration.
  let concentration: Concentration | undefined;
  const concAmount = Number(str(formData, "concentration_amount"));
  if (Number.isFinite(concAmount) && concAmount > 0) {
    const concUnit = inSet(str(formData, "concentration_unit"), DOSE_UNITS) ?? "mg";
    const perVolume = Number(str(formData, "concentration_per_volume") || "1");
    concentration = {
      amount: concAmount,
      unit: concUnit,
      per_volume: Number.isFinite(perVolume) && perVolume > 0 ? perVolume : 1,
      volume_unit: "mL",
    };
  }

  // Create medication via the RPC (same as manual creation).
  const frequency: Frequency = { type: "as_needed" }; // default for photo path
  const { data: medId, error: medErr } = await supabase.rpc(
    "create_manual_medication",
    {
      p_patient_id: active.id,
      p_display_name: displayName,
      p_is_private: false,
      p_prescribed: {
        dose_amount: doseAmount,
        dose_unit: doseUnit,
        route,
        frequency,
      },
      p_delivery: {
        form_type: formType,
        ...(concentration ? { concentration } : {}),
        expiry_date: str(formData, "expiry_date"),
        batch: str(formData, "batch"),
        manufacturer: str(formData, "manufacturer"),
      },
      p_chosen: {
        dose_amount: doseAmount,
        dose_unit: doseUnit,
        route,
        frequency,
      },
    }
  );

  if (medErr) failNew(`Could not save the medication: ${medErr.message}`);

  // Link the document to the medication.
  await admin
    .from("documents")
    .update({ linked_medication_id: medId })
    .eq("id", docId);

  // Gather user-confirmed values for delta comparison.
  const userValues: Record<string, string> = {
    drug_name_raw: displayName,
    drug_name_canonical: displayName,
    strength: str(formData, "strength"),
    concentration_amount: str(formData, "concentration_amount"),
    concentration_unit: str(formData, "concentration_unit"),
    concentration_per_volume: str(formData, "concentration_per_volume"),
    volume_ml: str(formData, "volume_ml"),
    route: str(formData, "route"),
    expiry_date: str(formData, "expiry_date"),
    batch: str(formData, "batch"),
    manufacturer: str(formData, "manufacturer"),
  };

  // Load prompt version ID and model used from the extraction metadata.
  const { data: prompt } = await admin
    .from("prompts")
    .select("current_version_id")
    .eq("slug", "extract_vial")
    .single();

  // Look up model used from the most recent llm_call_log for this prompt.
  const { data: lastLog } = await admin
    .from("llm_call_logs")
    .select("model_used")
    .eq("prompt_slug", "extract_vial")
    .eq("success", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  await writeExtractionDeltas({
    documentId: docId,
    drugCanonicalName: displayName,
    extraction,
    userValues,
    direction: "llm_to_user",
    promptSlug: "extract_vial",
    promptVersionId: (prompt?.current_version_id as string) ?? "",
    modelUsed: (lastLog?.model_used as string) ?? "unknown",
  });

  revalidatePath("/dashboard");
  redirect(`/medications/${medId as string}`);
}

/**
 * Confirm a prescription extraction: create the medication from the
 * user-edited fields and write extraction_deltas (PRD §5.2.3, §13.9).
 */
export async function confirmPrescriptionExtraction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active) failNew("No active patient.");
  if (active.role !== "owner") failNew("Only the patient owner can add a medication.");

  const docId = str(formData, "document_id");
  if (!docId) failNew("Missing document reference.");

  const admin = createAdminClient();

  const { data: doc } = await admin
    .from("documents")
    .select("extracted_json")
    .eq("id", docId)
    .single();
  if (!doc?.extracted_json) failNew("No extraction found for this document.");

  const extraction = doc.extracted_json as unknown as PrescriptionExtraction;

  const displayName = str(formData, "drug_name");
  if (!displayName) failNew("Enter the medication name.");

  const doseAmount = Number(str(formData, "dose_amount"));
  if (!Number.isFinite(doseAmount) || doseAmount <= 0) {
    failNew("Enter a valid dose amount.");
  }
  const doseUnit = inSet(str(formData, "dose_unit"), DOSE_UNITS);
  if (!doseUnit) failNew("Choose a valid dose unit.");
  const route = inSet(str(formData, "route"), ROUTES);
  if (!route) failNew("Choose a valid route.");

  const durationDays = str(formData, "duration_days");
  const prescriber = str(formData, "prescriber");

  // Parse frequency from the free-text field — default to as_needed.
  const frequency: Frequency = { type: "as_needed" };

  const { data: medId, error: medErr } = await supabase.rpc(
    "create_manual_medication",
    {
      p_patient_id: active.id,
      p_display_name: displayName,
      p_is_private: false,
      p_prescribed: {
        dose_amount: doseAmount,
        dose_unit: doseUnit,
        route,
        frequency,
        duration_days: durationDays,
        prescriber_name: prescriber,
      },
      p_delivery: {
        form_type: "pill_bottle",
      },
      p_chosen: {
        dose_amount: doseAmount,
        dose_unit: doseUnit,
        route,
        frequency,
      },
    }
  );

  if (medErr) failNew(`Could not save the medication: ${medErr.message}`);

  // Link the document.
  await admin
    .from("documents")
    .update({ linked_medication_id: medId })
    .eq("id", docId);

  // Write extraction deltas.
  const userValues: Record<string, string> = {
    drug_name: displayName,
    dose_amount: str(formData, "dose_amount"),
    dose_unit: str(formData, "dose_unit"),
    frequency: str(formData, "frequency"),
    duration_days: durationDays,
    route: str(formData, "route"),
    prescriber,
    refills: str(formData, "refills"),
  };

  const { data: prompt } = await admin
    .from("prompts")
    .select("current_version_id")
    .eq("slug", "extract_prescription")
    .single();

  const { data: lastLog } = await admin
    .from("llm_call_logs")
    .select("model_used")
    .eq("prompt_slug", "extract_prescription")
    .eq("success", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  await writeExtractionDeltas({
    documentId: docId,
    drugCanonicalName: displayName,
    extraction,
    userValues,
    direction: "llm_to_user",
    promptSlug: "extract_prescription",
    promptVersionId: (prompt?.current_version_id as string) ?? "",
    modelUsed: (lastLog?.model_used as string) ?? "unknown",
  });

  revalidatePath("/dashboard");
  redirect(`/medications/${medId as string}`);
}

/**
 * Run AI extraction on an existing document attached to a medication
 * (manual-first verification path, PRD §5.2.2).
 */
export async function runVerification(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const medicationId = str(formData, "medication_id");
  const documentId = str(formData, "document_id");

  if (!medicationId || !documentId) {
    failDose(medicationId, "Missing medication or document reference.");
  }

  // Load the document's storage path and generate a signed URL.
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path, mime_type")
    .eq("id", documentId)
    .single();
  if (!doc) failDose(medicationId, "Document not found.");

  // Download the image to base64 for the LLM.
  const { data: blob } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(doc.storage_path);
  if (!blob) failDose(medicationId, "Could not download the photo.");

  const buffer = Buffer.from(await blob.arrayBuffer());
  const base64 = `data:${doc.mime_type};base64,${buffer.toString("base64")}`;

  // Gather existing medication names for context.
  const { data: med } = await supabase
    .from("medications")
    .select("patient_id")
    .eq("id", medicationId)
    .single();
  if (!med) failDose(medicationId, "Medication not found.");

  const { data: meds } = await supabase
    .from("medications")
    .select("display_name")
    .eq("patient_id", med.patient_id)
    .eq("archived", false);
  const medNames = (meds ?? []).map((m) => m.display_name as string).join(", ");

  const result = await extractVial(documentId, base64, medNames, "metric");

  if (!result.ok) {
    failDose(medicationId, `Extraction failed: ${result.error}`);
  }

  redirect(`/medications/${medicationId}/verify?doc=${documentId}`);
}

// ── Reminders (PRD §5.5, §13.12) ──────────────────────────────────────────

/**
 * Enable a dose schedule for a medication. Creates a dose_schedules row
 * and generates the initial batch of reminders.
 */
export async function enableSchedule(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const medicationId = str(formData, "medication_id");
  if (!medicationId) redirect("/dashboard");

  // Load medication's patient_id.
  const { data: med } = await supabase
    .from("medications")
    .select("patient_id")
    .eq("id", medicationId)
    .single();
  if (!med) failDose(medicationId, "Medication not found.");

  const now = new Date();
  const scheduleId = crypto.randomUUID();

  const { error } = await supabase.from("dose_schedules").insert({
    id: scheduleId,
    medication_id: medicationId,
    patient_id: med.patient_id,
    next_due_at: now.toISOString(),
    generated_through: now.toISOString(),
  });

  if (error) {
    failDose(medicationId, `Could not enable reminders: ${error.message}`);
  }

  // Generate initial reminders (7-day lookahead).
  await generateReminders(scheduleId, 7);

  revalidatePath(`/medications/${medicationId}`);
  redirect(`/medications/${medicationId}`);
}

/**
 * Disable a dose schedule. Deletes the schedule and all pending reminders.
 */
export async function disableSchedule(formData: FormData) {
  const supabase = await createClient();
  const medicationId = str(formData, "medication_id");
  const scheduleId = str(formData, "schedule_id");

  if (!medicationId || !scheduleId) redirect("/dashboard");

  // Delete the schedule (cascades to dose_reminders via FK).
  const { error } = await supabase
    .from("dose_schedules")
    .delete()
    .eq("id", scheduleId);

  if (error) {
    failDose(medicationId, `Could not disable reminders: ${error.message}`);
  }

  revalidatePath(`/medications/${medicationId}`);
  redirect(`/medications/${medicationId}`);
}

// ── Drug interactions (PRD §5.8, §13.14) ───────────────────────────────────

/**
 * Render a curated drug interaction in plain English via the
 * explain_interaction prompt. The LLM does NOT enumerate — it only
 * explains the record we pass in (CLAUDE.md hard rule #9).
 */
export async function explainInteractionAction(
  formData: FormData
): Promise<string> {
  const drugA = str(formData, "drug_a_name");
  const drugB = str(formData, "drug_b_name");
  const mechanism = str(formData, "mechanism");
  const severity = str(formData, "severity");

  return explainInteraction(drugA, drugB, mechanism, severity);
}
