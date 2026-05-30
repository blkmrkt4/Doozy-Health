import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { revalidatePath } from "next/cache";
import { relativeAge } from "@/lib/format";

// Personal calibration page (PRD §4.8, §5.7). Opt-in: user enters blood
// readings, the engine back-solves a personal half-life and re-renders
// the timeline. Calibration changes the picture, never the advice posture.

async function addReading(formData: FormData) {
  "use server";
  const supabase = await (await import("@/lib/supabase/server")).createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const medicationId = (formData.get("medication_id") as string)?.trim();
  const value = Number((formData.get("value") as string)?.trim());
  const unit = (formData.get("unit") as string)?.trim();
  const observedAt = (formData.get("observed_at") as string)?.trim();
  const note = (formData.get("note") as string)?.trim() || null;

  if (!medicationId || !Number.isFinite(value) || value <= 0 || !unit || !observedAt) {
    redirect(`/medications/${medicationId}/calibrate?error=All+fields+are+required`);
  }

  const active = await (await import("@/lib/active-patient")).getActivePatient(supabase);
  if (!active) redirect("/dashboard");

  const { error } = await supabase.from("pk_calibrations").insert({
    patient_id: active.id,
    medication_id: medicationId,
    value,
    unit,
    observed_at: new Date(observedAt).toISOString(),
    note,
    logged_by_user_id: user.id,
  });

  if (error) {
    redirect(`/medications/${medicationId}/calibrate?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/medications/${medicationId}/calibrate`);
  redirect(`/medications/${medicationId}/calibrate`);
}

async function deleteReading(formData: FormData) {
  "use server";
  const supabase = await (await import("@/lib/supabase/server")).createClient();
  const readingId = (formData.get("reading_id") as string)?.trim();
  const medicationId = (formData.get("medication_id") as string)?.trim();

  if (readingId) {
    await supabase.from("pk_calibrations").delete().eq("id", readingId);
  }

  revalidatePath(`/medications/${medicationId}/calibrate`);
  redirect(`/medications/${medicationId}/calibrate`);
}

const inputCls =
  "block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent";

export default async function CalibratePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id: medicationId } = await params;
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active) redirect("/dashboard");

  const { data: med } = await supabase
    .from("medications")
    .select("id, display_name")
    .eq("id", medicationId)
    .single();
  if (!med) notFound();

  const { data: readings } = await supabase
    .from("pk_calibrations")
    .select("id, value, unit, observed_at, note")
    .eq("medication_id", medicationId)
    .order("observed_at", { ascending: false });

  const calibrations = (readings ?? []) as Array<{
    id: string;
    value: number;
    unit: string;
    observed_at: string;
    note: string | null;
  }>;

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link
            href={`/medications/${medicationId}/timeline`}
            className="text-sm text-faint hover:text-muted"
          >
            ← Timeline
          </Link>
          <span className="text-sm text-muted">{med.display_name}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 space-y-6">
        <h1 className="text-xl font-medium tracking-tight">
          Calibrate to your readings
        </h1>
        <p className="text-sm text-faint">
          If you have blood test results (e.g. trough levels your clinician
          ordered), you can enter them here. With two or more readings during a
          decline phase, the app will estimate your personal half-life and
          adjust the timeline curve.
        </p>
        <p className="text-xs text-muted">
          This is a personal estimate, not a measurement. It changes the
          picture, not the advice. Discuss results with your clinician.
        </p>

        {error ? (
          <p className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        {/* Add reading form */}
        <section className="rounded-md border border-line p-4 space-y-3">
          <h2 className="text-sm font-medium text-paper">Add a reading</h2>
          <form action={addReading} className="space-y-3">
            <input type="hidden" name="medication_id" value={medicationId} />
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="value" className="block text-sm text-muted">
                  Value
                </label>
                <input
                  id="value"
                  name="value"
                  type="number"
                  step="any"
                  required
                  placeholder="e.g. 450"
                  className={`${inputCls} mt-1 tabular`}
                />
              </div>
              <div>
                <label htmlFor="unit" className="block text-sm text-muted">
                  Unit
                </label>
                <input
                  id="unit"
                  name="unit"
                  type="text"
                  required
                  placeholder="e.g. ng/dL"
                  className={`${inputCls} mt-1`}
                />
              </div>
              <div>
                <label htmlFor="observed_at" className="block text-sm text-muted">
                  Date / time
                </label>
                <input
                  id="observed_at"
                  name="observed_at"
                  type="datetime-local"
                  required
                  className={`${inputCls} mt-1`}
                />
              </div>
            </div>
            <div>
              <label htmlFor="note" className="block text-sm text-muted">
                Note (optional)
              </label>
              <input
                id="note"
                name="note"
                type="text"
                placeholder="e.g. Trough before injection"
                className={`${inputCls} mt-1`}
              />
            </div>
            <button
              type="submit"
              className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90"
            >
              Add reading
            </button>
          </form>
        </section>

        {/* Readings list */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted">Your readings</h2>
          {calibrations.length === 0 ? (
            <p className="text-sm text-faint">No readings entered yet.</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {calibrations.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div>
                    <p className="tabular text-sm text-paper">
                      {c.value} {c.unit}
                    </p>
                    <p className="text-xs text-faint">
                      {relativeAge(c.observed_at)}
                      {c.note ? ` — ${c.note}` : ""}
                    </p>
                  </div>
                  <form action={deleteReading}>
                    <input type="hidden" name="reading_id" value={c.id} />
                    <input type="hidden" name="medication_id" value={medicationId} />
                    <button
                      type="submit"
                      className="text-xs text-faint underline hover:text-muted"
                    >
                      remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          {calibrations.length >= 2 ? (
            <p className="text-xs text-muted">
              Two or more readings found. The timeline will show your calibrated
              curve alongside the textbook curve.
            </p>
          ) : calibrations.length === 1 ? (
            <p className="text-xs text-faint">
              Add one more reading to enable calibration.
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
