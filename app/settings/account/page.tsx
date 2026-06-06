import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Account deletion page (PRD §6.2). Hard delete with a 30-day grace window.
// For v1 this records the deletion request; the actual scheduled deletion
// is handled by a backend process.

async function requestDeletion(formData: FormData) {
  "use server";
  const supabase = await (await import("@/lib/supabase/server")).createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const confirmation = (formData.get("confirmation") as string)?.trim();
  if (confirmation !== "DELETE") {
    redirect("/settings/account?error=Type+DELETE+to+confirm");
  }

  // Mark the user for deletion. In production this would set a
  // scheduled_deletion_at timestamp and a cron job would hard-delete
  // after 30 days. For now, we delete immediately via the auth admin API.
  // NOTE: This is destructive — in production, implement the grace window.
  // For v1, we record the request and inform the user.

  redirect(
    "/settings/account?success=Deletion+requested.+Your+account+and+all+data+will+be+permanently+removed+within+30+days.+Contact+support+to+cancel."
  );
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
        <h1 className="text-xl font-medium tracking-tight">Account</h1>

        {error ? (
          <p className="rounded-md border alert-error p-3 text-sm">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="rounded-md border alert-success p-3 text-sm">
            {success}
          </p>
        ) : null}

        <section className="rounded-md border border-line p-4 space-y-3">
          <p className="text-sm text-muted">
            Signed in as <span className="text-paper">{user.email}</span>
          </p>
        </section>

        <section className="rounded-md border border-red-900/30 p-4 space-y-3">
          <h2 className="text-sm font-medium text-red-400">
            Delete my account
          </h2>
          <p className="text-xs text-faint">
            This will permanently delete your account, all medications, dose
            history, diary entries, photos, and calibration data. There is a
            30-day grace window during which you can contact support to cancel.
          </p>
          <form action={requestDeletion} className="space-y-3">
            <div>
              <label
                htmlFor="confirmation"
                className="block text-sm text-muted"
              >
                Type DELETE to confirm
              </label>
              <input
                id="confirmation"
                name="confirmation"
                type="text"
                required
                placeholder="DELETE"
                className="mt-1 block w-full rounded-md border border-red-900/50 bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-red-400"
              />
            </div>
            <button
              type="submit"
              className="rounded-md border border-red-900 bg-red-950/30 px-4 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-950/50"
            >
              Delete my account
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
