import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { MedicationForm } from "./medication-form";

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
        <p className="mt-1 text-sm text-faint">
          Enter the three layers by hand. You can attach a photo for your
          records later.
        </p>

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
            <div className="mt-6">
              <MedicationForm />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
