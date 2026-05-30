import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { MedicationForm } from "./medication-form";
import { uploadAndExtract } from "@/app/medications/actions";

export default async function NewMedicationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active) redirect("/dashboard");

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-sm text-faint hover:text-muted">
            ← Back
          </Link>
          <span className="text-sm text-muted">{active.name}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-xl font-medium tracking-tight">Add a medication</h1>

        {active.role !== "owner" ? (
          <p className="mt-8 rounded-md border border-line bg-surface p-4 text-sm text-muted">
            Only the patient owner can add a medication.
          </p>
        ) : (
          <>
            {params.error ? (
              <p className="mt-6 rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
                {params.error}
              </p>
            ) : null}

            {/* ── Photo-first path (PRD §5.2.1, §13.8) ─────────── */}
            <section className="mt-6 rounded-md border border-line p-4 space-y-3">
              <h2 className="text-sm font-medium text-paper">
                Scan a vial or package
              </h2>
              <p className="text-xs text-faint">
                Take a photo and we will extract the details for you to review.
              </p>
              <form action={uploadAndExtract} className="flex items-end gap-3">
                <input
                  type="file"
                  name="photo"
                  accept="image/jpeg,image/png,image/heic,image/heif"
                  capture="environment"
                  required
                  className="flex-1 text-sm text-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-xs file:text-muted"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90"
                >
                  Extract
                </button>
              </form>
            </section>

            {/* ── Divider ───────────────────────────────────────── */}
            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-line" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-ink px-3 text-xs text-faint">
                  or enter manually
                </span>
              </div>
            </div>

            {/* ── Manual-entry path ─────────────────────────────── */}
            <MedicationForm />
          </>
        )}
      </main>
    </div>
  );
}
