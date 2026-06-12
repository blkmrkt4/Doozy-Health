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
  normaliseRoute,
  guessFormType,
  isCountDoseUnit,
  type Concentration,
  type DoseUnit,
  type Frequency,
  type Reconstitution,
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
import { accessoriesFromRequiredComponents } from "@/lib/medication-setup";
import { resolveOrCreateCanonicalDrug } from "@/lib/drug-reference";
import { generateReminders } from "@/lib/reminders";
import { explainInteraction } from "@/lib/interactions";
import { nextMedColour } from "@/lib/colours";
import { logWarn } from "@/lib/log";

function failNew(message: string): never {
  redirect(`/medications/new?error=${encodeURIComponent(message)}`);
}

/**
 * Build the reconstitution record when the user marked a vial as a powder they
 * mix. The concentration already carries the working numbers (amount = total
 * active in the vial, per_volume = the diluent volume the prescription says to
 * add); this records the provenance for display. Returns undefined when not a
 * reconstituted injectable.
 */
function buildReconstitution(
  formData: FormData,
  concentration: Concentration | null | undefined
): Reconstitution | undefined {
  if (str(formData, "is_reconstituted") !== "on") return undefined;
  if (!concentration || concentration.volume_unit !== "mL") return undefined;
  if (!(concentration.amount > 0) || !(concentration.per_volume > 0)) return undefined;
  return {
    requires_reconstitution: true,
    diluent_type: str(formData, "diluent_type") || "bacteriostatic water",
    diluent_volume_ml: concentration.per_volume,
    powder_amount: concentration.amount,
    powder_unit: concentration.unit,
  };
}

/**
 * Assign a distinct identity colour to a newly-created medication (PRD §9),
 * picking the next palette colour not already used by the patient's active
 * medications. Cosmetic — a failure here never blocks medication creation.
 */
async function assignMedColour(
  supabase: SupabaseClient,
  patientId: string,
  medId: string
): Promise<void> {
  const { data: existing } = await supabase
    .from("medications")
    .select("colour")
    .eq("patient_id", patientId)
    .eq("archived", false)
    .neq("id", medId);
  const colour = nextMedColour(
    (existing ?? []).map((r) => r.colour as string | null)
  );
  await supabase.from("medications").update({ colour }).eq("id", medId);
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
  label: string,
  fail: (msg: string) => never = failNew
): RegimenInput {
  const dose_amount = Number(str(formData, `${prefix}_dose_amount`));
  if (!Number.isFinite(dose_amount) || dose_amount <= 0) {
    fail(`Enter a ${label} dose amount greater than zero.`);
  }
  const dose_unit = inSet(str(formData, `${prefix}_dose_unit`), DOSE_UNITS);
  if (!dose_unit) fail(`Choose a valid ${label} dose unit.`);
  const route = inSet(str(formData, `${prefix}_route`), ROUTES);
  if (!route) fail(`Choose a valid ${label} route.`);
  const frequency = parseFrequency(formData, `${prefix}_freq`);
  if (!frequency) fail(`Complete the ${label} frequency.`);
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

  // Reconstitution (powder + diluent → concentration). The concentration above
  // carries the working numbers; this records the provenance for display.
  const reconstitution = buildReconstitution(formData, concentration);

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

  // Resolve the central drug reference inline (PRD §5.7): a known drug is a pure
  // cache hit; an unknown one is looked up once and cached for everyone. Failure
  // just leaves canonical_drug_id null (no modelled-level chart) — never blocks.
  const resolvedCanonicalId = await resolveOrCreateCanonicalDrug({
    name: displayName,
    route: chosen.route,
    canonicalDrugId,
  });

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
        directions: str(formData, "directions"),
      },
      p_delivery: {
        form_type: formType,
        ...(concentration ? { concentration } : {}),
        ...(reconstitution ? { reconstitution } : {}),
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
      p_canonical_drug_id: resolvedCanonicalId,
    }
  );

  if (error) {
    failNew(`Could not save the medication: ${error.message}`);
  }

  await assignMedColour(supabase, active.id, medId as string);

  revalidatePath("/dashboard");
  redirect(`/medications/${medId as string}?new=1`);
}

/**
 * Edit a medication — the same shape as creation (PRD §5.2.1, §5.3). The
 * prescribed regimen is immutable, so a change records a NEW prescription row
 * (history is kept and shown in the doctor PDF); the delivery form is likewise
 * versioned (a new fill); the chosen regimen is updated in place. Owner-only,
 * matching the regimen RLS policies and PRD §5.6. The dashboard wheel and PK
 * chart recompute from the updated values on next render.
 */
export async function updateMedication(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const medId = str(formData, "medication_id");
  if (!medId) redirect("/dashboard");
  const failEdit = (msg: string): never =>
    redirect(`/medications/${medId}/edit?error=${encodeURIComponent(msg)}`);

  const { data: med } = await supabase
    .from("medications")
    .select("id, patient_id")
    .eq("id", medId)
    .maybeSingle();
  if (!med) {
    redirect(
      `/medications/${medId}?error=${encodeURIComponent("Medication not found.")}`
    );
  }
  const patientId = med.patient_id as string;

  const role = await roleForPatient(supabase, patientId);
  if (role !== "owner") {
    failEdit("Only the patient owner can edit a medication.");
  }

  const displayName = str(formData, "drug_name");
  if (!displayName) failEdit("Enter the medication name.");
  const isPrivate = formData.get("is_private") === "on";
  const canonicalDrugId = str(formData, "canonical_drug_id") || null;

  const prescribed = parseRegimen(formData, "prescribed", "prescribed", failEdit);

  const formType = inSet(str(formData, "form_type"), FORM_TYPES);
  if (!formType) {
    redirect(
      `/medications/${medId}/edit?error=${encodeURIComponent("Choose the delivery form.")}`
    );
  }

  // Optional concentration (e.g. 200 mg/mL for a vial).
  let concentration: Concentration | null = null;
  const concAmount = Number(str(formData, "conc_amount"));
  if (str(formData, "conc_amount") !== "" && Number.isFinite(concAmount)) {
    const concUnit = inSet(str(formData, "conc_unit"), DOSE_UNITS);
    const perVolume = Number(str(formData, "conc_per_volume") || "1");
    if (!concUnit || !Number.isFinite(perVolume) || perVolume <= 0) {
      redirect(
        `/medications/${medId}/edit?error=${encodeURIComponent("Complete the concentration, or clear it.")}`
      );
    }
    concentration = {
      amount: concAmount,
      unit: concUnit,
      per_volume: perVolume,
      volume_unit: "mL",
    };
  }

  // Optional syringe spec (injectables only).
  let syringeSpec: SyringeSpec | null = null;
  const capacity = Number(str(formData, "syringe_capacity_ml"));
  if (str(formData, "syringe_capacity_ml") !== "" && Number.isFinite(capacity)) {
    syringeSpec = {
      capacity_mL: capacity,
      needle_gauge: Number(str(formData, "syringe_needle_gauge")) || 0,
      needle_length_in: Number(str(formData, "syringe_needle_length_in")) || 0,
      unit_markings: str(formData, "syringe_unit_markings"),
    };
  }

  const choseDiffers = formData.get("chosen_differs") === "on";
  const chosen = choseDiffers
    ? parseRegimen(formData, "chosen", "chosen", failEdit)
    : prescribed;
  const reasonNote = choseDiffers ? str(formData, "chosen_reason_note") : "";

  // 1) Medication identity fields (+ chosen syringe from inventory, PRD §5.1).
  const { error: medErr } = await supabase
    .from("medications")
    .update({
      display_name: displayName,
      is_private: isPrivate,
      canonical_drug_id: canonicalDrugId,
      syringe_id: str(formData, "syringe_id") || null,
    })
    .eq("id", medId);
  if (medErr) failEdit(`Could not save changes: ${medErr.message}`);

  // 2) Prescribed regimen is immutable — record a NEW version (PRD §5.3).
  const { error: presErr } = await supabase.from("prescribed_regimens").insert({
    medication_id: medId,
    patient_id: patientId,
    dose_amount: prescribed.dose_amount,
    dose_unit: prescribed.dose_unit,
    frequency: prescribed.frequency,
    route: prescribed.route,
    duration_days: Number(str(formData, "prescribed_duration_days")) || null,
    prescriber_name: str(formData, "prescriber_name") || null,
    directions: str(formData, "directions") || null,
  });
  if (presErr) failEdit(`Could not save the prescription: ${presErr.message}`);

  // 3) Delivery form — record a NEW version (a new fill).
  const { error: delErr } = await supabase.from("delivery_forms").insert({
    medication_id: medId,
    patient_id: patientId,
    form_type: formType,
    concentration,
    package_count: Number(str(formData, "package_count")) || null,
    package_unit: str(formData, "package_unit") || null,
    syringe_spec: syringeSpec,
    expiry_date: str(formData, "expiry_date") || null,
    batch: str(formData, "batch") || null,
    manufacturer: str(formData, "manufacturer") || null,
  });
  if (delErr) failEdit(`Could not save the delivery form: ${delErr.message}`);

  // 4) Chosen regimen — editable in place (PRD §5.3).
  const { error: chosenErr } = await supabase
    .from("chosen_regimens")
    .update({
      dose_amount: chosen.dose_amount,
      dose_unit: chosen.dose_unit,
      frequency: chosen.frequency,
      route: chosen.route,
      reason_note: reasonNote || null,
    })
    .eq("medication_id", medId)
    .eq("active", true);
  if (chosenErr) failEdit(`Could not save how you take it: ${chosenErr.message}`);

  revalidatePath("/dashboard");
  revalidatePath(`/medications/${medId}`);
  redirect(`/medications/${medId}`);
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

/**
 * Set (or clear) the syringe this medication is drawn with — the one gap the
 * setup checklist needs that the monolithic edit form otherwise owned. Owner-only
 * via RLS (a non-owner update matches 0 rows). Drives the calibrated syringe
 * visual + the checklist's "syringe" item (PRD §5.1).
 */
export async function setMedicationSyringe(formData: FormData) {
  const supabase = await createClient();
  const id = str(formData, "medication_id");
  const syringeId = str(formData, "syringe_id") || null;

  const { error } = await supabase
    .from("medications")
    .update({ syringe_id: syringeId })
    .eq("id", id);

  if (error) {
    redirect(`/medications/${id}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/medications/${id}`);
  redirect(`/medications/${id}`);
}

/**
 * Flip the "acknowledged" flag on one awareness accessory (spacer, oral syringe…)
 * in medications.accessories. Owner-only via RLS. Never blocks anything — it just
 * records that the user has the supply (PRD §5.1–5.3).
 */
export async function toggleAccessoryAcknowledged(formData: FormData) {
  const supabase = await createClient();
  const id = str(formData, "medication_id");
  const type = str(formData, "accessory_type");

  const { data: med } = await supabase
    .from("medications")
    .select("accessories")
    .eq("id", id)
    .maybeSingle();

  const list = Array.isArray(med?.accessories)
    ? (med!.accessories as Array<Record<string, unknown>>)
    : [];
  const next = list.map((a) =>
    a.type === type ? { ...a, acknowledged: a.acknowledged !== true } : a
  );

  const { error } = await supabase
    .from("medications")
    .update({ accessories: next })
    .eq("id", id);

  if (error) {
    redirect(`/medications/${id}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/medications/${id}`);
  redirect(`/medications/${id}`);
}

/**
 * Reset the supply on hand (a refill, or a recount). Records a new delivery
 * form — the sanctioned "new fill" mechanism (PRD §5.2) — copying the current
 * physical details and setting the new count, with a fresh created_at. Because
 * the run-out projection anchors on the newest delivery's created_at, this
 * resets the baseline: consumption is counted only from the refill onward.
 * Owners only (PRD §5.6).
 */
export async function updateSupply(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const medId = str(formData, "medication_id");
  if (!medId) redirect("/dashboard");
  const fail = (msg: string): never =>
    redirect(`/medications/${medId}?error=${encodeURIComponent(msg)}`);

  const { data: med } = await supabase
    .from("medications")
    .select("id, patient_id")
    .eq("id", medId)
    .maybeSingle();
  if (!med) fail("Medication not found.");

  const role = await roleForPatient(supabase, med!.patient_id as string);
  if (role !== "owner") fail("Only the patient owner can update the supply.");

  const count = Number(str(formData, "package_count"));
  if (!Number.isFinite(count) || count <= 0) {
    fail("Enter how many you have now (a number greater than zero).");
  }
  const unit = str(formData, "package_unit");

  // Copy the current physical details forward; only the count (and the fresh
  // created_at) change for a same-product refill.
  const { data: current } = await supabase
    .from("delivery_forms")
    .select(
      "patient_id, form_type, concentration, syringe_spec, reconstitution, package_unit, expiry_date, batch, manufacturer"
    )
    .eq("medication_id", medId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!current) fail("This medication has no delivery form to refill.");

  const { error } = await supabase.from("delivery_forms").insert({
    medication_id: medId,
    patient_id: current!.patient_id,
    form_type: current!.form_type,
    concentration: current!.concentration,
    syringe_spec: current!.syringe_spec,
    reconstitution: current!.reconstitution,
    package_count: count,
    package_unit: unit || current!.package_unit,
    expiry_date: current!.expiry_date,
    batch: current!.batch,
    manufacturer: current!.manufacturer,
  });
  if (error) fail(`Could not update the supply: ${error.message}`);

  revalidatePath(`/medications/${medId}`);
  revalidatePath("/dashboard");
  redirect(`/medications/${medId}`);
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

/** Bring an archived medication back into the active list (owner-only via RLS). */
export async function unarchiveMedication(formData: FormData) {
  const supabase = await createClient();
  const id = str(formData, "medication_id");

  const { error } = await supabase
    .from("medications")
    .update({ archived: false })
    .eq("id", id);

  if (error) {
    redirect(`/dashboard?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/dashboard");
  redirect(`/medications/${id}`);
}

/**
 * Permanently delete a medication and everything owned by it (PRD §5.6). Unlike
 * archiving, this removes it from charts and the clinician report. Child rows
 * cascade via FKs; documents unlink. Owner-only — enforced by the
 * medications_owner_delete RLS policy, so a blocked attempt deletes 0 rows
 * rather than erroring.
 */
export async function deleteMedication(formData: FormData) {
  const supabase = await createClient();
  const id = str(formData, "medication_id");
  if (!id) redirect("/dashboard");

  const { error, count } = await supabase
    .from("medications")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) {
    redirect(`/medications/${id}?error=${encodeURIComponent(error.message)}`);
  }
  if (!count) {
    redirect(
      `/medications/${id}?error=${encodeURIComponent(
        "Only the patient owner can delete a medication."
      )}`
    );
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
  redirect(str(formData, "return_to") || `/medications/${medicationId}`);
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
  const returnTo = str(formData, "return_to") || `/medications/${medicationId}`;

  const { error } = await supabase.from("dose_logs").delete().eq("id", logId);
  if (error) failDose(medicationId, `Could not remove the log: ${error.message}`);

  revalidatePath("/dashboard");
  revalidatePath(`/medications/${medicationId}`);
  redirect(returnTo);
}

/**
 * Log a single "taken" dose without redirecting — for the tap-through check-dot
 * agenda (optimistic UI). Owner+caregiver. Best-effort: on any problem it just
 * revalidates, so the optimistic state reconciles to the real count.
 */
export async function quickLogDose(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const medicationId = str(formData, "medication_id");
  const { data: med } = await supabase
    .from("medications")
    .select("patient_id")
    .eq("id", medicationId)
    .maybeSingle();
  if (!med) return;
  const role = await roleForPatient(supabase, med.patient_id);
  if (role !== "owner" && role !== "caregiver") return;

  const amountRaw = str(formData, "amount");
  const amount = Number(amountRaw);
  const unit = inSet(str(formData, "unit"), DOSE_UNITS);
  if (!amountRaw || !Number.isFinite(amount) || amount <= 0 || !unit) return;
  const routeRaw = str(formData, "route_taken");
  const route = routeRaw ? inSet(routeRaw, ROUTES) : null;

  const whenRaw = str(formData, "logged_at");
  let loggedAt: string | undefined;
  if (whenRaw) {
    const d = new Date(whenRaw);
    if (!Number.isNaN(d.getTime())) loggedAt = d.toISOString();
  }

  const row: Record<string, unknown> = {
    medication_id: medicationId,
    patient_id: med.patient_id,
    event_type: "taken",
    amount: amountRaw,
    unit,
    route_taken: route,
    note: str(formData, "note") || null,
    source: role === "caregiver" ? "caregiver" : "manual",
    logged_by_user_id: user.id,
  };
  if (loggedAt) row.logged_at = loggedAt;

  await supabase.from("dose_logs").insert(row);
  revalidatePath("/dashboard");
  revalidatePath(`/medications/${medicationId}`);
}

/** Remove a single dose log without redirecting (tap-through agenda undo). */
export async function quickUnlogDose(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const medicationId = str(formData, "medication_id");
  const logId = str(formData, "log_id");
  if (!logId) return;

  await supabase.from("dose_logs").delete().eq("id", logId);
  revalidatePath("/dashboard");
  revalidatePath(`/medications/${medicationId}`);
}

// ── AI extraction (PRD §5.2, §13.8–9) ──────────────────────────────────────

function failExtract(message: string): never {
  redirect(`/medications/new?error=${encodeURIComponent(message)}`);
}

// A validation failure while confirming an extraction must keep the user ON the
// review page with their extracted data intact — never bounce back to the scan
// screen (which silently discards the extraction). Always pass the doc id.
function failReview(docId: string, message: string): never {
  redirect(
    `/medications/new/extract?doc=${docId}&error=${encodeURIComponent(message)}`
  );
}

/**
 * Map an internal extraction error to clean, advice-free user copy. Internal
 * causes (missing key, model / prompt / binding problems) must never surface in
 * the UI — the regulatory line forbids any model/OpenRouter reference, and they
 * are logged server-side instead. Helpful, already-clean guidance (e.g. the
 * wrong document type was chosen) is passed through unchanged.
 */
function userExtractionMessage(rawError: string): string {
  if (
    /openrouter|api key|not configured|\bmodel\b|all models|\bprompt\b|binding|\bversion\b/i.test(
      rawError
    )
  ) {
    return "Photo scanning is temporarily unavailable. You can enter the details manually below.";
  }
  if (/parse/i.test(rawError)) {
    return "We couldn't read the details from that photo. Try a clearer, well-lit photo, or enter them manually below.";
  }
  // Already clean and helpful (e.g. document-type mismatch guidance).
  return rawError;
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

  // One or more photos (e.g. different sides of a curved vial). They are read
  // together by the model; the FIRST is stored as the document of record.
  const MAX_PHOTOS = 5;
  const photos = formData
    .getAll("photo")
    .filter((f): f is File => f instanceof File && f.size > 0)
    .slice(0, MAX_PHOTOS);

  if (photos.length === 0) {
    failExtract("Choose a photo to scan.");
  }
  for (const f of photos) {
    if (!isAllowedMime(f.type) || f.type === "application/pdf") {
      failExtract("Please use image files (JPEG, PNG, or HEIC).");
    }
    if (f.size > MAX_DOCUMENT_BYTES) {
      failExtract("One of the photos is larger than the 25 MB limit.");
    }
  }
  const file = photos[0];

  // Upload the first photo as the document of record.
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

  // Convert every photo to a base64 data URL for the LLM.
  const base64s: string[] = [];
  for (const f of photos) {
    const buffer = Buffer.from(await f.arrayBuffer());
    base64s.push(`data:${f.type};base64,${buffer.toString("base64")}`);
  }
  const base64 = base64s;

  // Gather existing medication names for context.
  const { data: meds } = await supabase
    .from("medications")
    .select("display_name")
    .eq("patient_id", active.id)
    .eq("archived", false);
  const medNames = (meds ?? []).map((m) => m.display_name as string).join(", ");

  // Run extraction with the chosen type. If the photo is actually the OTHER
  // type, the extractor flags it (typeMismatch); rather than bouncing the user
  // back to re-pick, we transparently re-run with the correct extractor and
  // explain the switch on the review screen (PRD §5.2).
  const runExtraction = (type: "prescription_scan" | "vial_photo") =>
    type === "prescription_scan"
      ? extractPrescription(docId, base64, medNames)
      : extractVial(docId, base64, medNames, "metric");

  let result = await runExtraction(documentType);
  let switchedFrom: "prescription_scan" | "vial_photo" | null = null;

  if (!result.ok && result.typeMismatch) {
    const otherType =
      documentType === "prescription_scan" ? "vial_photo" : "prescription_scan";
    const retried = await runExtraction(otherType);
    if (retried.ok) {
      result = retried;
      switchedFrom = documentType;
      // Persist the corrected type so the document record matches what we read.
      await supabase
        .from("documents")
        .update({ document_type: otherType })
        .eq("id", docId);
    } else {
      // Neither type read cleanly — genuinely unreadable, not just a wrong pick.
      logWarn("extraction", "Type mismatch and retry both failed", {
        documentId: docId,
        documentType,
        otherType,
      });
      failExtract(
        "We couldn't read this as a vial or a prescription. Try a clearer, well-lit photo, or enter the details manually below."
      );
    }
  }

  if (!result.ok) {
    // Loud in the server log (raw cause + correlation ids, no health values),
    // clean and advice-free in the UI.
    logWarn("extraction", "Extraction failed", {
      documentId: docId,
      documentType,
      cause: result.error,
    });
    redirect(
      `/medications/new?error=${encodeURIComponent(userExtractionMessage(result.error))}`
    );
  }

  // Redirect to the review page; flag a transparent type switch so the page can
  // explain it ("you chose Vial, but this reads as a prescription").
  const switchedParam = switchedFrom
    ? `&switched=${switchedFrom === "prescription_scan" ? "prescription_to_vial" : "vial_to_prescription"}`
    : "";
  redirect(`/medications/new/extract?doc=${docId}${switchedParam}`);
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
  if (!doc?.extracted_json) failReview(docId, "No extraction found for this document.");

  const extraction = doc.extracted_json as unknown as VialExtraction;

  // Read user-confirmed values from the form.
  const displayName = str(formData, "drug_name");
  if (!displayName) failReview(docId, "Enter the medication name.");

  const doseAmount = Number(str(formData, "dose_amount"));
  if (!Number.isFinite(doseAmount) || doseAmount <= 0) {
    failReview(docId, "Enter a valid dose amount.");
  }
  const doseUnit = inSet(str(formData, "dose_unit"), DOSE_UNITS);
  if (!doseUnit) failReview(docId, "Choose a valid dose unit.");
  // Accept the canonical code or a human-readable phrasing ("by mouth" → oral).
  const route =
    inSet(str(formData, "route"), ROUTES) ?? normaliseRoute(str(formData, "route"));
  if (!route) failReview(docId, "Choose a valid route.");

  // Store the concentration / strength on the delivery form.
  // - Solid oral (tablet/capsule): the per-unit STRENGTH, e.g. 10 mg per 1
  //   tablet — so "1 tablet" always carries its mg (PRD §5.11).
  // - Injectable: the liquid concentration, e.g. 200 mg per 1 mL.
  let concentration: Concentration | undefined;
  if (isCountDoseUnit(doseUnit)) {
    const strengthAmount = Number(str(formData, "strength_amount"));
    if (Number.isFinite(strengthAmount) && strengthAmount > 0) {
      const strengthUnit =
        inSet(str(formData, "strength_unit"), DOSE_UNITS) ?? "mg";
      concentration = {
        amount: strengthAmount,
        unit: strengthUnit,
        per_volume: 1,
        volume_unit: doseUnit as "tablet" | "capsule",
      };
    }
  } else {
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
  }

  // Infer the delivery form from the route + a real liquid concentration
  // instead of defaulting to "vial": eye/ear/nose drops and oral pills aren't
  // injectables. A count-unit "strength" (10 mg per 1 tablet) is NOT a liquid
  // concentration, so only an mL-based one counts toward the guess.
  const liquidConc = concentration?.volume_unit === "mL" ? concentration : null;
  const formType =
    inSet(str(formData, "form_type"), FORM_TYPES) ??
    guessFormType({
      route,
      concentrationAmount: liquidConc?.amount ?? null,
      concentrationPerVolume: liquidConc?.per_volume ?? null,
    });

  const reconstitution = buildReconstitution(formData, concentration);

  // Schedule captured on the review form (falls back to PRN if not set).
  const frequency: Frequency =
    parseFrequency(formData, "freq") ?? { type: "as_needed" };
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
        duration_days: str(formData, "duration_days"),
        directions: str(formData, "directions"),
      },
      p_delivery: {
        form_type: formType,
        ...(concentration ? { concentration } : {}),
        ...(reconstitution ? { reconstitution } : {}),
        package_count: str(formData, "package_count"),
        package_unit: str(formData, "package_unit"),
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

  if (medErr) failReview(docId, `Could not save the medication: ${medErr.message}`);

  await assignMedColour(supabase, active.id, medId as string);

  // Link the document to the medication.
  await admin
    .from("documents")
    .update({ linked_medication_id: medId })
    .eq("id", docId);

  // Seed the setup checklist's awareness accessories the model inferred from the
  // vial (e.g. a spacer, an oral syringe). Data-bearing components are covered by
  // the checklist's rules, so they're filtered out here.
  const vialAccessories = accessoriesFromRequiredComponents(
    extraction.required_components ?? [],
    "label"
  );
  if (vialAccessories.length > 0) {
    await admin
      .from("medications")
      .update({ accessories: vialAccessories })
      .eq("id", medId);
  }

  // Resolve/cache the central drug reference for the chart (PRD §5.7).
  const vialCanonicalId = await resolveOrCreateCanonicalDrug({ name: displayName, route });
  if (vialCanonicalId) {
    await admin.from("medications").update({ canonical_drug_id: vialCanonicalId }).eq("id", medId as string);
  }

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
  if (!doc?.extracted_json) failReview(docId, "No extraction found for this document.");

  const extraction = doc.extracted_json as unknown as PrescriptionExtraction;

  const displayName = str(formData, "drug_name");
  if (!displayName) failReview(docId, "Enter the medication name.");

  const doseAmount = Number(str(formData, "dose_amount"));
  if (!Number.isFinite(doseAmount) || doseAmount <= 0) {
    failReview(docId, "Enter a valid dose amount.");
  }
  const doseUnit = inSet(str(formData, "dose_unit"), DOSE_UNITS);
  if (!doseUnit) failReview(docId, "Choose a valid dose unit.");
  // Accept the canonical code or a human-readable phrasing ("by mouth" → oral).
  const route =
    inSet(str(formData, "route"), ROUTES) ?? normaliseRoute(str(formData, "route"));
  if (!route) failReview(docId, "Choose a valid route.");

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
        directions: str(formData, "directions"),
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

  if (medErr) failReview(docId, `Could not save the medication: ${medErr.message}`);

  await assignMedColour(supabase, active.id, medId as string);

  // Link the document.
  await admin
    .from("documents")
    .update({ linked_medication_id: medId })
    .eq("id", docId);

  // Seed awareness accessories the model inferred from the prescription (a
  // spacer, an oral syringe…). Data-bearing components are covered by rules.
  const rxAccessories = accessoriesFromRequiredComponents(
    extraction.required_components ?? [],
    "prescription"
  );
  if (rxAccessories.length > 0) {
    await admin
      .from("medications")
      .update({ accessories: rxAccessories })
      .eq("id", medId);
  }

  // Resolve/cache the central drug reference for the chart (PRD §5.7).
  const rxCanonicalId = await resolveOrCreateCanonicalDrug({ name: displayName, route });
  if (rxCanonicalId) {
    await admin.from("medications").update({ canonical_drug_id: rxCanonicalId }).eq("id", medId as string);
  }

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

// ── Single-use / OTC dose logging (PRD §5.10.1 Phase B) ─────────────────────

export type LogOneOffResult = { ok: true } | { ok: false; error: string };

/**
 * Record a one-off, not-in-inventory medication (Tylenol, ibuprofen, NyQuil).
 * Resolves the canonical drug (brand→generic via lookup_drug_pk) so it feeds the
 * curated interaction check + the Snapshot, then the SECURITY DEFINER RPC
 * find-or-creates a `single_use` medication row and inserts a PRN dose log.
 * Owners and caregivers may log; viewers cannot (enforced again in the RPC).
 */
export async function logSingleUseDose(formData: FormData): Promise<LogOneOffResult> {
  const supabase = await createClient();
  const active = await getActivePatient(supabase);
  if (!active) return { ok: false, error: "No active patient." };
  if (active.role === "viewer") return { ok: false, error: "Viewers cannot log doses." };

  const name = str(formData, "name");
  if (!name) return { ok: false, error: "Enter a medication name." };

  const amountRaw = str(formData, "amount");
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter a dose amount." };
  }
  const unit = inSet(str(formData, "unit"), DOSE_UNITS);
  if (!unit) return { ok: false, error: "Choose a unit." };

  const route = normaliseRoute(str(formData, "route")) ?? "oral";
  const note = str(formData, "note") || null;
  const loggedAtRaw = str(formData, "logged_at");
  const loggedAt = loggedAtRaw ? new Date(loggedAtRaw).toISOString() : null;

  // Resolve a canonical drug so interactions can be checked (best-effort; a null
  // result just means no interaction match / no PK chart — never blocks logging).
  const canonicalDrugId = await resolveOrCreateCanonicalDrug({ name, route });

  const { error } = await supabase.rpc("log_single_use_dose", {
    p_patient_id: active.id,
    p_display_name: name,
    p_canonical_drug_id: canonicalDrugId,
    p_amount: amountRaw,
    p_unit: unit,
    p_route: route,
    p_note: note,
    p_logged_at: loggedAt,
  });
  if (error) return { ok: false, error: "Could not log this medication. Please try again." };

  revalidatePath("/dashboard");
  return { ok: true };
}
