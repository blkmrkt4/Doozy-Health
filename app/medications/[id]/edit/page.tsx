import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFrequency, type FormType } from "@/lib/types";
import {
  MedicationForm,
  type MedicationFormInitial,
} from "@/app/medications/new/medication-form";
import { updateMedication } from "@/app/medications/actions";

// Edit a medication using the same form as creation (PRD §5.2.1, §5.3),
// pre-filled with current values. Owner-only.

function byNewest<T extends { created_at: string }>(rows: T[] | null): T[] {
  return [...(rows ?? [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

type FreqInit = NonNullable<MedicationFormInitial["prescribed"]>["freq"];

function freqInit(freq: unknown): FreqInit {
  if (isFrequency(freq)) {
    if (freq.type === "every")
      return { type: "every", interval: freq.interval, unit: freq.unit };
    if (freq.type === "times_per")
      return { type: "times_per", count: freq.count, period: freq.period };
    return { type: "as_needed" };
  }
  return { type: "every" };
}

export default async function EditMedicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error: errorParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("medications")
    .select(
      "id, patient_id, display_name, canonical_drug_id, is_private, archived, syringe_id, prescribed_regimens(*), delivery_forms(*), chosen_regimens(*)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  const { data: membership } = await supabase
    .from("patient_memberships")
    .select("role")
    .eq("patient_id", data.patient_id)
    .maybeSingle();

  // The patient's syringes, for the injectable syringe picker.
  const { data: syringeRows } = await supabase
    .from("inventory_items")
    .select("id, label")
    .eq("archived", false)
    .order("created_at", { ascending: false });
  const syringes = (syringeRows ?? []) as { id: string; label: string }[];
  if (membership?.role !== "owner") {
    // Only the owner may edit; send others back to the read view.
    redirect(`/medications/${id}`);
  }

  type Row = { created_at: string; active?: boolean } & Record<string, unknown>;
  const prescribed = byNewest((data.prescribed_regimens ?? []) as Row[])[0] as
    | Row
    | undefined;
  const delivery = byNewest((data.delivery_forms ?? []) as Row[])[0] as
    | Row
    | undefined;
  const chosenList = (data.chosen_regimens ?? []) as Row[];
  const chosen: Row | undefined =
    chosenList.find((c) => c.active) ?? byNewest(chosenList)[0];

  const conc = (delivery?.concentration ?? null) as Record<string, unknown> | null;
  const syr = (delivery?.syringe_spec ?? null) as Record<string, unknown> | null;

  const str = (v: unknown): string | undefined =>
    v === null || v === undefined ? undefined : String(v);

  // Whether the chosen regimen genuinely differs from the prescription.
  const differs =
    !!prescribed &&
    !!chosen &&
    !(
      Number(prescribed.dose_amount) === Number(chosen.dose_amount) &&
      prescribed.dose_unit === chosen.dose_unit &&
      prescribed.route === chosen.route &&
      JSON.stringify(prescribed.frequency) === JSON.stringify(chosen.frequency)
    );

  const initial: MedicationFormInitial = {
    drugName: data.display_name,
    canonicalDrugId: data.canonical_drug_id ?? undefined,
    isPrivate: data.is_private,
    syringeId: (data.syringe_id as string | null) ?? undefined,
    prescribed: prescribed
      ? {
          doseAmount: str(prescribed.dose_amount),
          doseUnit: str(prescribed.dose_unit),
          route: str(prescribed.route),
          freq: freqInit(prescribed.frequency),
          durationDays: str(prescribed.duration_days),
          prescriberName: str(prescribed.prescriber_name),
          directions: str(prescribed.directions),
        }
      : undefined,
    delivery: delivery
      ? {
          formType: str(delivery.form_type) as FormType | undefined,
          concAmount: str(conc?.amount),
          concUnit: str(conc?.unit),
          concPerVolume: str(conc?.per_volume),
          packageCount: str(delivery.package_count),
          packageUnit: str(delivery.package_unit),
          syringeCapacityMl: str(syr?.capacity_mL),
          syringeNeedleGauge: str(syr?.needle_gauge),
          syringeNeedleLengthIn: str(syr?.needle_length_in),
          syringeUnitMarkings: str(syr?.unit_markings),
          expiryDate: str(delivery.expiry_date),
          batch: str(delivery.batch),
          manufacturer: str(delivery.manufacturer),
        }
      : undefined,
    chosen: chosen
      ? {
          differs,
          doseAmount: str(chosen.dose_amount),
          doseUnit: str(chosen.dose_unit),
          route: str(chosen.route),
          freq: freqInit(chosen.frequency),
          reasonNote: str(chosen.reason_note),
        }
      : undefined,
  };

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link
            href={`/medications/${id}`}
            className="text-sm text-faint hover:text-muted"
          >
            ← Back
          </Link>
          <span className="text-xs text-faint">Edit medication</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="mb-6 text-lg font-medium text-paper">
          Edit <span className="blur-private">{data.display_name}</span>
        </h1>

        {errorParam ? (
          <p className="mb-4 rounded-md border alert-error p-3 text-sm">
            {errorParam}
          </p>
        ) : null}

        <p className="mb-6 text-xs text-faint">
          Editing &ldquo;what was prescribed&rdquo; records a new prescription
          and keeps the previous one as history. Reminders are managed from the
          medication page.
        </p>

        <MedicationForm
          action={updateMedication}
          medicationId={id}
          submitLabel="Save changes"
          cancelHref={`/medications/${id}`}
          syringes={syringes}
          initial={initial}
        />
      </main>
    </div>
  );
}
