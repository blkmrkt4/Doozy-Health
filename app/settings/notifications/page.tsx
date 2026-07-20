import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { EnableNotifications } from "@/app/_components/enable-notifications";

// Device notifications settings (PRD §5.5). Per-device push opt-in; the
// per-medication reminder and caregiver-escalation configuration lives on
// each medication's page, where the schedule is.

export default async function NotificationSettingsPage() {
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
          <Link href="/settings" className="text-sm text-faint hover:text-muted">
            ← Settings
          </Link>
          <span className="text-sm text-muted">{active.name}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-xl font-medium tracking-tight">Notifications</h1>

        <div className="mt-6 space-y-3">
          <section className="rounded-md border border-line p-4 space-y-3">
            <h2 className="text-sm font-medium text-paper">This device</h2>
            <p className="text-xs text-faint">
              With notifications on, this device receives dose reminders for
              schedules that have them, and — if you&rsquo;re named as a
              caregiver contact — a note when a dose hasn&rsquo;t been logged.
            </p>
            <EnableNotifications />
          </section>

          <section className="rounded-md border border-line p-4">
            <h2 className="text-sm font-medium text-paper">Per medication</h2>
            <p className="mt-1 text-xs text-faint">
              Reminder schedules and the caregiver contact for each medication
              are set on that medication&rsquo;s page.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
