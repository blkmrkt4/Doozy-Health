import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { signOut } from "@/app/login/actions";

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

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-baseline gap-3">
            <span className="text-base font-medium tracking-tight">
              Doozy<span className="text-accent"> Health</span>
            </span>
            {/* Caregiver context is always visible (PRD §9): the top bar makes
                clear whose data is on screen. The one-tap switcher arrives with
                caregiver invitations in build step 13. */}
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
        <section className="rounded-md border border-dashed border-line px-6 py-16 text-center">
          <p className="text-sm text-muted">
            No medications yet.
          </p>
          <p className="mt-1 text-xs text-faint">
            Adding medications arrives next. For now, sign-in, the patient
            record, and the membership scope are in place.
          </p>
        </section>

        {profile?.is_system_admin ? (
          <p className="mt-16 text-xs text-faint">
            <Link
              href="/admin/settings"
              className="underline hover:text-muted"
            >
              Admin
            </Link>
          </p>
        ) : null}
      </main>
    </div>
  );
}
