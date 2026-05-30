import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  formatDose,
  formatFrequency,
  formatRoute,
  relativeAge,
} from "@/lib/format";
import {
  FORM_TYPE_LABELS,
  INJECTABLE_FORM_TYPES,
  type FormType,
} from "@/lib/types";
import {
  archiveMedication,
  attachMedicationPhoto,
  deleteDocument,
  deleteDoseLog,
  logScheduledDose,
  runVerification,
  setMedicationPrivacy,
} from "@/app/medications/actions";
import {
  DOCUMENTS_BUCKET,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/documents";
import { LogDoseForm } from "./log-dose-form";

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
  canonical_drug_id: string | null;
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
      "id, patient_id, display_name, canonical_drug_id, is_private, entry_source, archived, prescribed_regimens(*), delivery_forms(*), chosen_regimens(*)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const med = data as Medication;

  // Owner controls require the owner role on THIS medication's patient;
  // owners and caregivers can log doses (PRD §5.6).
  const { data: membership } = await supabase
    .from("patient_memberships")
    .select("role")
    .eq("patient_id", med.patient_id)
    .maybeSingle();
  const isOwner = membership?.role === "owner";
  const canLog = isOwner || membership?.role === "caregiver";

  const prescribed = byNewest(med.prescribed_regimens)[0] ?? null;
  const delivery = byNewest(med.delivery_forms)[0] ?? null;
  const chosen =
    (med.chosen_regimens ?? []).find((c) => c.active) ??
    byNewest(med.chosen_regimens)[0] ??
    null;

  const isInjectable = delivery
    ? INJECTABLE_FORM_TYPES.has(delivery.form_type as FormType)
    : false;

  // Recent dose history (RLS-scoped to this medication's visibility).
  const { data: logData } = await supabase
    .from("dose_logs")
    .select("id, event_type, logged_at, amount, unit, route_taken, site, note, source")
    .eq("medication_id", med.id)
    .order("logged_at", { ascending: false })
    .limit(50);
  const logs = logData ?? [];

  // Attached documents + short-lived signed URLs (PRD §6.2). RLS scopes the
  // rows; the signed URLs respect storage RLS (is_private-aware).
  const { data: docData } = await supabase
    .from("documents")
    .select("id, storage_path, file_name, mime_type, document_type, status, uploaded_at")
    .eq("linked_medication_id", med.id)
    .order("uploaded_at", { ascending: false });
  const docs = docData ?? [];
  const docUrls = new Map<string, string>();
  if (docs.length > 0) {
    const { data: signed } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrls(
        docs.map((d) => d.storage_path),
        SIGNED_URL_TTL_SECONDS
      );
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) docUrls.set(s.path, s.signedUrl);
    }
  }

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
          {/* Timeline link — shown when drug has PK data (PRD §4.4, §5.7) */}
          {med.canonical_drug_id ? (
            <Link
              href={`/medications/${med.id}/timeline`}
              className="mt-1 inline-block text-sm text-accent hover:underline"
            >
              View timeline
            </Link>
          ) : null}
        </div>

        {errorParam ? (
          <p className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
            {errorParam}
          </p>
        ) : null}

        {/* Log a dose — the primary action. One tap for the scheduled dose;
            "Log differently" expands the custom/PRN/skip path (§4.3, §5.4). */}
        {canLog && chosen ? (
          <section className="flex flex-wrap items-center gap-3 rounded-md border border-line p-4">
            <form action={logScheduledDose}>
              <input type="hidden" name="medication_id" value={med.id} />
              <input type="hidden" name="return_to" value={`/medications/${med.id}`} />
              <button
                type="submit"
                className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90"
              >
                Taken now
              </button>
            </form>
            <LogDoseForm
              medicationId={med.id}
              defaultAmount={String(chosen.dose_amount)}
              defaultUnit={chosen.dose_unit}
              defaultRoute={chosen.route}
              isInjectable={isInjectable}
            />
          </section>
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

        {/* Photos & documents (PRD §5.1). Attach a vial/prescription photo for
            your records; reading + extraction (step 8) build on this. */}
        <section className="rounded-md border border-line p-4">
          <h2 className="text-sm font-medium text-paper">Photos &amp; documents</h2>

          {docs.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-3">
              {docs.map((d) => {
                const url = docUrls.get(d.storage_path);
                const isImage = d.mime_type.startsWith("image/");
                return (
                  <li key={d.id} className="relative">
                    <a
                      href={url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block h-20 w-20 overflow-hidden rounded-md border border-line bg-surface"
                      title={d.file_name}
                    >
                      {isImage && url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={url}
                          alt={d.file_name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-xs text-faint">
                          {d.mime_type === "application/pdf" ? "PDF" : "FILE"}
                        </span>
                      )}
                    </a>
                    <div className="mt-1 flex justify-center gap-2">
                      {/* Verify with AI (PRD §5.2.2) — for image docs that
                          haven't been extracted yet. */}
                      {canLog &&
                        d.mime_type.startsWith("image/") &&
                        d.status === "uploaded" ? (
                        <form action={runVerification}>
                          <input type="hidden" name="medication_id" value={med.id} />
                          <input type="hidden" name="document_id" value={d.id} />
                          <button
                            type="submit"
                            className="text-xs text-accent underline hover:opacity-80"
                          >
                            verify
                          </button>
                        </form>
                      ) : null}
                      {canLog ? (
                        <form action={deleteDocument}>
                          <input type="hidden" name="medication_id" value={med.id} />
                          <input type="hidden" name="document_id" value={d.id} />
                          <button
                            type="submit"
                            className="text-xs text-faint underline hover:text-muted"
                          >
                            remove
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-faint">No photos attached.</p>
          )}

          {canLog ? (
            <form
              action={attachMedicationPhoto}
              className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4"
            >
              <input type="hidden" name="medication_id" value={med.id} />
              <label className="block text-sm text-muted">
                Type
                <select
                  name="document_type"
                  defaultValue="vial_photo"
                  className="mt-1 block rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent"
                >
                  {DOCUMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {DOCUMENT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <input
                type="file"
                name="file"
                required
                accept="image/jpeg,image/png,image/heic,image/heif,application/pdf"
                capture="environment"
                className="text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-2 file:text-sm file:text-paper"
              />
              <button
                type="submit"
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90"
              >
                Attach
              </button>
            </form>
          ) : null}
        </section>

        {/* Dose history — neutral, chronological; no streaks or guilt (§9). */}
        <section className="rounded-md border border-line p-4">
          <h2 className="text-sm font-medium text-paper">History</h2>
          {logs.length === 0 ? (
            <p className="mt-2 text-sm text-faint">No doses logged yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {logs.map((l) => (
                <li
                  key={l.id}
                  className="flex items-baseline justify-between gap-4 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-paper">
                      {l.event_type === "skipped" ? (
                        <span className="text-faint">Skipped</span>
                      ) : (
                        <span className="tabular">
                          {formatDose(l.amount as string, l.unit as string)}
                          {l.event_type === "prn" ? (
                            <span className="ml-2 text-xs text-faint">PRN</span>
                          ) : null}
                        </span>
                      )}
                      {l.route_taken ? (
                        <span className="ml-2 text-xs text-faint">
                          {formatRoute(l.route_taken)}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-faint">
                      {relativeAge(l.logged_at as string)}
                      {l.site ? ` · ${l.site}` : ""}
                      {l.source === "caregiver" ? " · by caregiver" : ""}
                      {l.note ? ` · ${l.note}` : ""}
                    </p>
                  </div>
                  {canLog ? (
                    <form action={deleteDoseLog} className="shrink-0">
                      <input type="hidden" name="medication_id" value={med.id} />
                      <input type="hidden" name="log_id" value={l.id as string} />
                      <button
                        type="submit"
                        className="text-xs text-faint underline transition-colors hover:text-muted"
                        title="Undo this log"
                      >
                        undo
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
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
