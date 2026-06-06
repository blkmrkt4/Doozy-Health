import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { MedicationForm } from "./medication-form";
import { ScanForm } from "./scan-form";

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
              <p className="mt-6 rounded-md border alert-error p-3 text-sm">
                {params.error}
              </p>
            ) : null}

            <ScanForm />

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
