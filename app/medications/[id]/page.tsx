import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  formatDose,
  formatFrequency,
  formatRoute,
} from "@/lib/format";
import { FORM_TYPE_LABELS, type FormType } from "@/lib/types";
import { archiveMedication, setMedicationPrivacy } from "@/app/medications/actions";

type Regimen = {
  dose_amount: string;
  dose_unit: string;
  frequency: unknown;
  route: string;
  created_at: string;
  duration_days?: number | null;
  prescriber_name?: string | null;
  reason_note?: string | null;
  active?: boolean;
};

type DeliveryForm = {
  form_type: string;
  concentration: {
    amount: number;
    unit: string;
    per_volume: number;
    volume_unit: string;
  } | null;
  package_count: string | null;
  package_unit: string | null;
  expiry_date: string | null;
  batch: string | null;
  manufacturer: string | null;
  created_at: string;
};

type Medication = {
  id: string;
  patient_id: string;
  display_name: string;
  is_private: boolean;
  entry_source: string;
  archived: boolean;
  prescribed_regimens: Regimen[] | null;
  delivery_forms: DeliveryForm[] | null;
  chosen_regimens: Regimen[] | null;
};

function byNewest<T extends { created_at: string }>(rows: T[] | null): T[] {
  return [...(rows ?? [])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs text-faint">{label}</span>
      <span className="tabular text-sm text-paper text-right">{value}</span>
    </div>
  );
}

export default async function MedicationDetailPage({
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
      "id, patient_id, display_name, is_private, entry_source, archived, prescribed_regimens(*), delivery_forms(*), chosen_regimens(*)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const med = data as Medication;

  // Owner controls require the owner role on THIS medication's patient.
  const { data: membership } = await supabase
    .from("patient_memberships")
    .select("role")
    .eq("patient_id", med.patient_id)
    .maybeSingle();
  const isOwner = membership?.role === "owner";

  const prescribed = byNewest(med.prescribed_regimens)[0] ?? null;
  const delivery = byNewest(med.delivery_forms)[0] ?? null;
  const chosen =
    (med.chosen_regimens ?? []).find((c) => c.active) ??
    byNewest(med.chosen_regimens)[0] ??
    null;

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-sm text-faint hover:text-muted">
            ← Back
          </Link>
          <span className="text-xs text-faint">
            {med.entry_source === "manual" ? "Entered manually" : "From a photo"}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-xl font-medium tracking-tight">
            {med.display_name}
            {med.is_private ? (
              <span className="ml-2 align-middle text-sm text-faint" title="Private">
                🔒
              </span>
            ) : null}
          </h1>
        </div>

        {errorParam ? (
          <p className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
            {errorParam}
          </p>
        ) : null}

        {/* Chosen regimen — the layer that drives schedule + timeline. Shown
            first because it's what the user acts on. */}
        <section className="rounded-md border border-line p-4">
          <h2 className="text-sm font-medium text-paper">How you take it</h2>
          {chosen ? (
            <div className="mt-2">
              <Field
                label="Dose"
                value={formatDose(chosen.dose_amount, chosen.dose_unit)}
              />
              <Field label="Frequency" value={formatFrequency(chosen.frequency)} />
              <Field label="Route" value={formatRoute(chosen.route)} />
              {chosen.reason_note ? (
                <Field label="Reason" value={chosen.reason_note} />
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm text-faint">Not set.</p>
          )}
        </section>

        {/* Prescribed regimen */}
        <section className="rounded-md border border-line p-4">
          <h2 className="text-sm font-medium text-paper">What was prescribed</h2>
          {prescribed ? (
            <div className="mt-2">
              <Field
                label="Dose"
                value={formatDose(prescribed.dose_amount, prescribed.dose_unit)}
              />
              <Field
                label="Frequency"
                value={formatFrequency(prescribed.frequency)}
              />
              <Field label="Route" value={formatRoute(prescribed.route)} />
              {prescribed.duration_days ? (
                <Field
                  label="Duration"
                  value={`${prescribed.duration_days} days`}
                />
              ) : null}
              {prescribed.prescriber_name ? (
                <Field label="Prescriber" value={prescribed.prescriber_name} />
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm text-faint">Not set.</p>
          )}
        </section>

        {/* Delivery form */}
        <section className="rounded-md border border-line p-4">
          <h2 className="text-sm font-medium text-paper">What you have in hand</h2>
          {delivery ? (
            <div className="mt-2">
              <Field
                label="Form"
                value={
                  FORM_TYPE_LABELS[delivery.form_type as FormType] ??
                  delivery.form_type
                }
              />
              {delivery.concentration ? (
                <Field
                  label="Concentration"
                  value={`${delivery.concentration.amount} ${delivery.concentration.unit} / ${delivery.concentration.per_volume} ${delivery.concentration.volume_unit}`}
                />
              ) : null}
              {delivery.package_count ? (
                <Field
                  label="Pack"
                  value={`${delivery.package_count} ${delivery.package_unit ?? ""}`.trim()}
                />
              ) : null}
              {delivery.expiry_date ? (
                <Field label="Expiry" value={delivery.expiry_date} />
              ) : null}
              {delivery.batch ? <Field label="Batch" value={delivery.batch} /> : null}
              {delivery.manufacturer ? (
                <Field label="Manufacturer" value={delivery.manufacturer} />
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm text-faint">Not set.</p>
          )}
        </section>

        {/* Owner controls */}
        {isOwner ? (
          <section className="flex flex-wrap gap-3 border-t border-line pt-6">
            {med.is_private ? (
              <form action={setMedicationPrivacy}>
                <input type="hidden" name="medication_id" value={med.id} />
                <button
                  type="submit"
                  className="rounded-md border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-surface"
                >
                  Make visible to caregivers
                </button>
              </form>
            ) : (
              <form action={setMedicationPrivacy}>
                <input type="hidden" name="medication_id" value={med.id} />
                <input type="hidden" name="is_private" value="on" />
                <button
                  type="submit"
                  className="rounded-md border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-surface"
                >
                  Make private
                </button>
              </form>
            )}
            <form action={archiveMedication}>
              <input type="hidden" name="medication_id" value={med.id} />
              <button
                type="submit"
                className="rounded-md border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-surface"
              >
                Archive
              </button>
            </form>
          </section>
        ) : null}
      </main>
    </div>
  );
}
