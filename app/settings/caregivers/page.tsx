import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActivePatient } from "@/lib/active-patient";
import {
  inviteCaregiver,
  removeMembership,
  changeRole,
} from "./actions";

// Caregivers settings page (PRD §4.5, §13.13). Owner-only. Lists all
// memberships on the active patient, with invite/remove/role-change controls.

export default async function CaregiversPage({
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

  const active = await getActivePatient(supabase);
  if (!active || active.role !== "owner") redirect("/dashboard");

  // Load all memberships for this patient via the security-definer helper.
  const admin = createAdminClient();
  const { data: memberships } = await admin
    .from("patient_memberships")
    .select("id, user_id, role, accepted_at, invited_by, created_at")
    .eq("patient_id", active.id)
    .order("created_at");

  // Load emails for all member user IDs.
  const memberIds = (memberships ?? []).map((m) => m.user_id as string);
  const { data: userProfiles } = await admin
    .from("users")
    .select("id, email")
    .in("id", memberIds.length > 0 ? memberIds : ["__none__"]);

  const emailMap = new Map(
    (userProfiles ?? []).map((u) => [u.id as string, u.email as string])
  );

  const members = (memberships ?? []).map((m) => ({
    id: m.id as string,
    userId: m.user_id as string,
    email: emailMap.get(m.user_id as string) ?? "Unknown",
    role: m.role as string,
    accepted: Boolean(m.accepted_at),
    isSelf: m.user_id === user.id,
    createdAt: m.created_at as string,
  }));

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
          <span className="text-sm text-muted">{active.name}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 space-y-6">
        <h1 className="text-xl font-medium tracking-tight">Caregivers</h1>

        {error ? (
          <p className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="rounded-md border border-green-900 bg-green-950/40 p-3 text-sm text-green-300">
            {success}
          </p>
        ) : null}

        {/* Current members */}
        <section className="rounded-md border border-line p-4 space-y-3">
          <h2 className="text-sm font-medium text-paper">Members</h2>
          {members.length === 0 ? (
            <p className="text-sm text-faint">No members.</p>
          ) : (
            <ul className="divide-y divide-line">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-paper">
                      {m.email}
                      {m.isSelf ? (
                        <span className="ml-1 text-xs text-faint">(you)</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-faint">
                      <span
                        className={
                          m.role === "owner"
                            ? "text-accent"
                            : m.role === "caregiver"
                              ? "text-muted"
                              : "text-faint"
                        }
                      >
                        {m.role}
                      </span>
                      {!m.accepted ? (
                        <span className="ml-2 text-yellow-400">pending</span>
                      ) : null}
                    </p>
                  </div>

                  {/* Actions: change role + remove (not for self or owner) */}
                  {!m.isSelf && m.role !== "owner" ? (
                    <div className="flex shrink-0 gap-2">
                      <form action={changeRole}>
                        <input type="hidden" name="membership_id" value={m.id} />
                        <input
                          type="hidden"
                          name="role"
                          value={m.role === "caregiver" ? "viewer" : "caregiver"}
                        />
                        <button
                          type="submit"
                          className="text-xs text-muted underline hover:text-paper"
                        >
                          → {m.role === "caregiver" ? "viewer" : "caregiver"}
                        </button>
                      </form>
                      <form action={removeMembership}>
                        <input type="hidden" name="membership_id" value={m.id} />
                        <button
                          type="submit"
                          className="text-xs text-faint underline hover:text-red-400"
                        >
                          remove
                        </button>
                      </form>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Invite form */}
        <section className="rounded-md border border-line p-4 space-y-3">
          <h2 className="text-sm font-medium text-paper">Invite</h2>
          <form action={inviteCaregiver} className="space-y-3">
            <div>
              <label htmlFor="email" className="block text-sm text-muted">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="caregiver@example.com"
                className="mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent"
              />
            </div>
            <div>
              <label htmlFor="role" className="block text-sm text-muted">
                Role
              </label>
              <select
                id="role"
                name="role"
                defaultValue="caregiver"
                className="mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent"
              >
                <option value="caregiver">
                  Caregiver — can log doses, view non-private medications
                </option>
                <option value="viewer">
                  Viewer — read-only access to non-private medications
                </option>
              </select>
            </div>
            <button
              type="submit"
              className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90"
            >
              Send invite
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
