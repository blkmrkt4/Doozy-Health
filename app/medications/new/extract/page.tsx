import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePatient } from "@/lib/active-patient";
import { DOCUMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/documents";
import {
  DOSE_UNITS,
  ROUTES,
  ROUTE_LABELS,
  normaliseRoute,
} from "@/lib/types";
import {
  ExtractionField,
  ExtractionSelect,
} from "@/app/medications/_components/extraction-field";
import { VialDoseForm } from "@/app/medications/_components/vial-dose-form";

const ROUTE_OPTIONS = ROUTES.map((r) => ({ value: r, label: ROUTE_LABELS[r] }));
const DOSE_UNIT_OPTIONS = DOSE_UNITS.map((u) => ({ value: u, label: u }));

/** Pre-select a valid dose unit, defaulting to mg if the extracted one is odd. */
function defaultDoseUnit(raw: string): string {
  return (DOSE_UNITS as readonly string[]).includes(raw) ? raw : "mg";
}
import {
  confirmPhotoExtraction,
  confirmPrescriptionExtraction,
} from "@/app/medications/actions";
import type { VialExtraction, PrescriptionExtraction } from "@/lib/extraction";

// Extraction review page (PRD §5.2.1). Shows extracted fields with confidence
// indicators for user review/editing before creating the medication.
// Handles both vial and prescription extractions (§13.8–9).
// Extraction NEVER auto-commits (hard rule #6).

function isVialExtraction(obj: unknown): obj is VialExtraction {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "drug_name_raw" in obj &&
    "concentration_amount" in obj
  );
}

// When the chosen type didn't match the photo, uploadAndExtract re-runs with
// the correct extractor and passes ?switched=… so we can explain it here rather
// than having rejected the upload.
function switchNotice(switched: string | undefined): string | null {
  if (switched === "vial_to_prescription") {
    return "You chose Vial / package, but this photo reads as a prescription — so we extracted it as a prescription. Review the details below.";
  }
  if (switched === "prescription_to_vial") {
    return "You chose Prescription, but this photo reads as a vial or package label — so we extracted it as a vial. Review the details below.";
  }
  return null;
}

export default async function ExtractionReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string; error?: string; switched?: string }>;
}) {
  const { doc: docId, error, switched } = await searchParams;
  if (!docId) notFound();
  const switchedNote = switchNotice(switched);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active || active.role !== "owner") redirect("/dashboard");

  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("documents")
    .select("id, storage_path, extracted_json, status, document_type")
    .eq("id", docId)
    .single();

  if (!doc || doc.status !== "extracted" || !doc.extracted_json) {
    redirect("/medications/new?error=No+extraction+found+for+this+document");
  }

  const isVial = isVialExtraction(doc.extracted_json);
  const vial = isVial ? (doc.extracted_json as unknown as VialExtraction) : null;
  const rx = !isVial
    ? (doc.extracted_json as unknown as PrescriptionExtraction)
    : null;

  // Generate signed URL for the thumbnail.
  const { data: signed } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
  const thumbnailUrl = signed?.signedUrl ?? null;

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link
            href="/medications/new"
            className="text-sm text-faint hover:text-muted"
          >
            ← Discard extraction
          </Link>
          <span className="text-sm text-muted">{active.name}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-xl font-medium tracking-tight">
          Review {isVial ? "vial" : "prescription"} extraction
        </h1>
        <p className="mt-1 text-sm text-faint">
          Check each field below. Edit anything the AI got wrong, then confirm
          to create the medication.
        </p>

        {switchedNote ? (
          <p className="mt-4 rounded-md border border-accent/40 bg-surface p-3 text-sm text-muted">
            {switchedNote}
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        {thumbnailUrl ? (
          <div className="mt-6">
            <a
              href={thumbnailUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnailUrl}
                alt="Source photo"
                className="h-32 rounded-md border border-line object-cover"
              />
            </a>
            <p className="mt-1 text-xs text-faint">Tap to view full image</p>
          </div>
        ) : null}

        {/* ── Vial extraction form ───────────────────────────────── */}
        {vial ? (
          <form action={confirmPhotoExtraction} className="mt-6 space-y-6">
            <input type="hidden" name="document_id" value={docId} />

            <fieldset className="space-y-2 rounded-md border border-line p-4">
              <legend className="text-sm font-medium text-paper">
                Directions
              </legend>
              <p className="text-xs text-faint">
                Copied exactly as written on the label. Kept verbatim with the
                medication so you — or a caregiver — always see how it&rsquo;s
                meant to be taken. Edit only to fix a misread.
              </p>
              <textarea
                name="directions"
                rows={2}
                defaultValue={vial.directions?.value ?? ""}
                placeholder="e.g. Take 1 tablet by mouth every morning"
                className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent"
              />
            </fieldset>

            <fieldset className="space-y-4 rounded-md border border-line p-4">
              <legend className="text-sm font-medium text-paper">
                Drug identity
              </legend>
              <ExtractionField
                label="Drug name"
                name="drug_name"
                value={
                  vial.drug_name_canonical.value || vial.drug_name_raw.value
                }
                confidence={vial.drug_name_canonical.confidence}
              />
              <ExtractionField
                label="Strength"
                name="strength"
                value={vial.strength.value}
                confidence={vial.strength.confidence}
              />
              <ExtractionSelect
                label="Route"
                name="route"
                value={normaliseRoute(vial.route.value) ?? ""}
                confidence={vial.route.confidence}
                options={ROUTE_OPTIONS}
                placeholder="Select a route…"
              />
            </fieldset>

            {/* Form-aware dosing: the delivery-form selector switches between
                an injectable (concentration + syringe volume) and a solid oral
                form (take N tablets). A pill never gets the injectable UI. */}
            <VialDoseForm
              strength={vial.strength.value}
              route={normaliseRoute(vial.route.value) ?? ""}
              defaultDoseUnit={vial.concentration_unit.value || "mg"}
              concentration={{
                amount: vial.concentration_amount.value,
                unit: vial.concentration_unit.value || "mg",
                perVolume: vial.concentration_per_volume.value,
                volumeMl: vial.volume_ml.value,
                amountConfidence: vial.concentration_amount.confidence,
                unitConfidence: vial.concentration_unit.confidence,
                perVolumeConfidence: vial.concentration_per_volume.confidence,
                volumeConfidence: vial.volume_ml.confidence,
              }}
            />

            <fieldset className="space-y-4 rounded-md border border-line p-4">
              <legend className="text-sm font-medium text-paper">
                Packaging details
              </legend>
              <ExtractionField
                label="Manufacturer"
                name="manufacturer"
                value={vial.manufacturer.value}
                confidence={vial.manufacturer.confidence}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <ExtractionField
                  label="Batch / lot"
                  name="batch"
                  value={vial.batch.value}
                  confidence={vial.batch.confidence}
                />
                <ExtractionField
                  label="Expiry date"
                  name="expiry_date"
                  value={vial.expiry_date.value}
                  confidence={vial.expiry_date.confidence}
                />
              </div>
            </fieldset>

            <SubmitButtons />
          </form>
        ) : null}

        {/* ── Prescription extraction form ────────────────────────── */}
        {rx ? (
          <form
            action={confirmPrescriptionExtraction}
            className="mt-6 space-y-6"
          >
            <input type="hidden" name="document_id" value={docId} />

            <fieldset className="space-y-2 rounded-md border border-line p-4">
              <legend className="text-sm font-medium text-paper">
                Directions
              </legend>
              <p className="text-xs text-faint">
                The dosing instructions as written. Kept with the medication so
                you — or a caregiver — can always see how it&rsquo;s meant to be
                taken.
              </p>
              <textarea
                name="directions"
                rows={2}
                placeholder="e.g. Take 1 tablet by mouth every morning"
                className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent"
              />
            </fieldset>

            <fieldset className="space-y-4 rounded-md border border-line p-4">
              <legend className="text-sm font-medium text-paper">
                Drug identity
              </legend>
              <ExtractionField
                label="Drug name"
                name="drug_name"
                value={rx.drug_name.value}
                confidence={rx.drug_name.confidence}
              />
              <ExtractionSelect
                label="Route"
                name="route"
                value={normaliseRoute(rx.route.value) ?? ""}
                confidence={rx.route.confidence}
                options={ROUTE_OPTIONS}
                placeholder="Select a route…"
              />
            </fieldset>

            <fieldset className="space-y-4 rounded-md border border-line p-4">
              <legend className="text-sm font-medium text-paper">
                Prescribed regimen
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <ExtractionField
                  label="Dose amount"
                  name="dose_amount"
                  value={String(rx.dose_amount.value ?? "")}
                  confidence={rx.dose_amount.confidence}
                  type="number"
                  step="any"
                />
                <ExtractionSelect
                  label="Dose unit"
                  name="dose_unit"
                  value={defaultDoseUnit(rx.dose_unit.value)}
                  confidence={rx.dose_unit.confidence}
                  options={DOSE_UNIT_OPTIONS}
                />
              </div>
              <ExtractionField
                label="Frequency"
                name="frequency"
                value={rx.frequency.value}
                confidence={rx.frequency.confidence}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <ExtractionField
                  label="Duration (days)"
                  name="duration_days"
                  value={String(rx.duration_days.value ?? "")}
                  confidence={rx.duration_days.confidence}
                  type="number"
                />
                <ExtractionField
                  label="Refills"
                  name="refills"
                  value={String(rx.refills.value ?? "")}
                  confidence={rx.refills.confidence}
                  type="number"
                />
              </div>
            </fieldset>

            <fieldset className="space-y-4 rounded-md border border-line p-4">
              <legend className="text-sm font-medium text-paper">
                Prescriber
              </legend>
              <ExtractionField
                label="Prescriber name"
                name="prescriber"
                value={rx.prescriber.value}
                confidence={rx.prescriber.confidence}
              />
            </fieldset>

            <SubmitButtons />
          </form>
        ) : null}
      </main>
    </div>
  );
}

function SubmitButtons() {
  return (
    <div className="flex gap-3 pt-2">
      <button
        type="submit"
        className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90"
      >
        Confirm & create medication
      </button>
      <Link
        href="/medications/new"
        className="rounded-md border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-surface"
      >
        Discard
      </Link>
    </div>
  );
}
