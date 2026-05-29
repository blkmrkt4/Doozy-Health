import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { signOut } from "@/app/login/actions";
import { formatRegimenSummary } from "@/lib/format";

type ChosenRow = {
  dose_amount: string;
  dose_unit: string;
  frequency: unknown;
  route: string;
  active: boolean;
};

type MedicationRow = {
  id: string;
  display_name: string;
  is_private: boolean;
  entry_source: string;
  chosen_regimens: ChosenRow[] | null;
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("email, is_system_admin")
    .eq("id", user.id)
    .maybeSingle();

  const activePatient = await getActivePatient(supabase);

  // RLS already restricts these rows to medications the caller may read,
  // including the is_private override for non-owners (PRD §5.6).
  const { data } = await supabase
    .from("medications")
    .select(
      "id, display_name, is_private, entry_source, chosen_regimens(dose_amount, dose_unit, frequency, route, active)"
    )
    .eq("archived", false)
    .eq("chosen_regimens.active", true)
    .order("created_at", { ascending: false });

  const medications = (data ?? []) as MedicationRow[];
  const isOwner = activePatient?.role === "owner";

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-baseline gap-3">
            <span className="text-base font-medium tracking-tight">
              Doozy<span className="text-accent"> Health</span>
            </span>
            {activePatient ? (
              <span className="text-sm text-muted">
                · {activePatient.name}
                {activePatient.role !== "owner" ? (
                  <span className="ml-1 text-faint">({activePatient.role})</span>
                ) : null}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-faint">{profile?.email ?? user.email}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-md border border-line px-3 py-1.5 text-muted transition-colors hover:bg-surface"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <section className="flex items-center justify-between">
          <h1 className="text-sm font-medium text-muted">Medications</h1>
          {isOwner ? (
            <Link
              href="/medications/new"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90"
            >
              + Add medication
            </Link>
          ) : null}
        </section>

        {medications.length === 0 ? (
          <section className="mt-8 rounded-md border border-dashed border-line px-6 py-16 text-center">
            <p className="text-sm text-muted">No medications yet.</p>
            {isOwner ? (
              <p className="mt-1 text-xs text-faint">
                Add your first to start tracking.
              </p>
            ) : null}
          </section>
        ) : (
          <ul className="mt-6 divide-y divide-line overflow-hidden rounded-md border border-line">
            {medications.map((m) => {
              const chosen = (m.chosen_regimens ?? []).find((c) => c.active);
              return (
                <li key={m.id}>
                  <Link
                    href={`/medications/${m.id}`}
                    className="flex items-baseline justify-between gap-4 px-4 py-4 transition-colors hover:bg-surface"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-base font-medium text-paper">
                        {m.display_name}
                        {m.is_private ? (
                          <span
                            className="ml-2 align-middle text-xs text-faint"
                            title="Private"
                          >
                            🔒
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs text-faint">
                        {m.entry_source === "manual" ? "Entered manually" : "From a photo"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {chosen ? (
                        <p className="tabular text-sm text-muted">
                          {formatRegimenSummary(chosen)}
                        </p>
                      ) : (
                        <p className="text-sm text-faint">—</p>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {profile?.is_system_admin ? (
          <p className="mt-16 text-xs text-faint">
            <Link href="/admin/settings" className="underline hover:text-muted">
              Admin
            </Link>
          </p>
        ) : null}
      </main>
    </div>
  );
}
