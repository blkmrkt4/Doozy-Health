"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
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
