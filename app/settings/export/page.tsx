import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";

// Data export page (PRD §6.2). Records export events in the exports table.
// For a formatted summary to share, the user uses the Health snapshot (/report).

export default async function ExportPage({
  searchParams,
}: {
  searchParams: Promise<{ exported?: string }>;
}) {
  const { exported } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active) redirect("/dashboard");

  // Load export history.
  const { data: exports } = await supabase
    .from("exports")
    .select("id, generated_at")
    .eq("patient_id", active.id)
    .order("generated_at", { ascending: false })
    .limit(10);

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link
            href="/settings"
            className="text-sm text-faint hover:text-muted"
          >
            ← Settings
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 space-y-6">
        <h1 className="text-xl font-medium tracking-tight">
          Export your data
        </h1>

        {exported ? (
          <p className="rounded-md border alert-success p-3 text-sm">
            Export recorded.
          </p>
        ) : null}

        <section className="rounded-md border border-line p-4 space-y-3">
          <p className="text-sm text-faint">
            You can export all your data at any time. For a formatted summary
            to share with your clinician, use the{" "}
            <Link href="/report" className="text-accent hover:underline">
              Health snapshot
            </Link>
            .
          </p>
          <p className="text-sm text-faint">
            A full machine-readable JSON export is available on request.
            Your data is yours — we do not restrict access to it.
          </p>
        </section>

        {(exports ?? []).length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted">Export history</h2>
            <ul className="divide-y divide-line rounded-md border border-line">
              {(exports ?? []).map((e) => (
                <li
                  key={e.id as string}
                  className="px-4 py-2 text-sm text-faint"
                >
                  {new Date(e.generated_at as string).toLocaleString("en-GB")}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
