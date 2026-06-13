import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";

// Settings hub page. Links to sub-pages (caregivers, tracking, the Health
// snapshot, account).

export default async function SettingsPage() {
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
          <Link
            href="/dashboard"
            className="text-sm text-faint hover:text-muted"
          >
            ← Dashboard
          </Link>
          <span className="text-sm text-muted">{active.name}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-xl font-medium tracking-tight">Settings</h1>

        <div className="mt-6 space-y-3">
          {active.role === "owner" ? (
            <>
              <Link
                href="/settings/caregivers"
                className="block rounded-md border border-line p-4 hover:border-muted"
              >
                <h2 className="text-sm font-medium text-paper">Caregivers</h2>
                <p className="mt-1 text-xs text-faint">
                  Invite caregivers and viewers, manage access to{" "}
                  {active.name}&rsquo;s medications.
                </p>
              </Link>
              <Link
                href="/settings/tracking"
                className="block rounded-md border border-line p-4 hover:border-muted"
              >
                <h2 className="text-sm font-medium text-paper">
                  Diary tracking fields
                </h2>
                <p className="mt-1 text-xs text-faint">
                  Choose what to track in your diary — mood, sleep, symptoms.
                </p>
              </Link>
            </>
          ) : null}
          <Link
            href="/report"
            className="block rounded-md border border-line p-4 hover:border-muted"
          >
            <h2 className="text-sm font-medium text-paper">Health snapshot</h2>
            <p className="mt-1 text-xs text-faint">
              Build a shareable summary of {active.name}&rsquo;s medications,
              doses, and tracked measures to bring to a doctor.
            </p>
          </Link>
          <Link
            href="/settings/account"
            className="block rounded-md border border-line p-4 hover:border-muted"
          >
            <h2 className="text-sm font-medium text-paper">Account</h2>
            <p className="mt-1 text-xs text-faint">
              Manage your account or request deletion.
            </p>
          </Link>
        </div>
      </main>
    </div>
  );
}
