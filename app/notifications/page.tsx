import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";

// Notifications — placeholder (PRD §5.5 reminders land later). The nav item
// exists now; there's nothing to show yet.

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active) redirect("/dashboard");

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-xl font-medium tracking-tight">Notifications</h1>
      <div className="mt-8 rounded-md border border-dashed border-line px-6 py-16 text-center">
        <p className="text-sm text-muted">No notifications yet.</p>
        <p className="mt-1 text-xs text-faint">
          Dose reminders and other updates will show up here.
        </p>
      </div>
    </main>
  );
}
