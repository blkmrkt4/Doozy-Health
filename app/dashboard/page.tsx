import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { signOut } from "@/app/login/actions";
import { logScheduledDose } from "@/app/medications/actions";
import { acceptInvite, declineInvite } from "@/app/settings/caregivers/actions";
import { formatRegimenSummary, relativeAge } from "@/lib/format";
import { PatientSwitcher } from "@/app/_components/patient-switcher";

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
  canonical_drug_id: string | null;
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

  // Load all patient memberships for the patient switcher (PRD §9, §13.13).
  const { data: membershipRows } = await supabase
    .from("patient_memberships")
    .select("patient_id, role, accepted_at, patients(name)")
    .order("created_at");

  type SwitcherPatient = { id: string; name: string; role: "owner" | "caregiver" | "viewer" };
  const allPatients: SwitcherPatient[] = ((membershipRows ?? []) as Array<{
    patient_id: string;
    role: string;
    accepted_at: string | null;
    patients: { name: string } | { name: string }[] | null;
  }>)
    .filter((m) => m.accepted_at !== null) // only accepted memberships
    .map((m) => {
      const p = Array.isArray(m.patients) ? m.patients[0] : m.patients;
      return {
        id: m.patient_id,
        name: p?.name ?? "Patient",
        role: m.role as SwitcherPatient["role"],
      };
    });

  // Pending invites for this user (not yet accepted).
  const pendingInvites = ((membershipRows ?? []) as Array<{
    patient_id: string;
    role: string;
    accepted_at: string | null;
    patients: { name: string } | { name: string }[] | null;
  }>)
    .filter((m) => m.accepted_at === null)
    .map((m) => {
      const p = Array.isArray(m.patients) ? m.patients[0] : m.patients;
      // Need the membership ID for accept/decline. Re-query would be cleaner
      // but we'll use the patient_id to find it.
      return {
        patientId: m.patient_id,
        patientName: p?.name ?? "Patient",
        role: m.role,
      };
    });

  // Load membership IDs for pending invites (needed for the accept form).
  let pendingMembershipIds = new Map<string, string>();
  if (pendingInvites.length > 0) {
    const { data: pendingRows } = await supabase
      .from("patient_memberships")
      .select("id, patient_id")
      .is("accepted_at", null);
    for (const r of pendingRows ?? []) {
      pendingMembershipIds.set(r.patient_id as string, r.id as string);
    }
  }

  // RLS already restricts these rows to medications the caller may read,
  // including the is_private override for non-owners (PRD §5.6).
  const { data } = await supabase
    .from("medications")
    .select(
      "id, display_name, canonical_drug_id, is_private, entry_source, chosen_regimens(dose_amount, dose_unit, frequency, route, active)"
    )
    .eq("archived", false)
    .eq("chosen_regimens.active", true)
    .order("created_at", { ascending: false });

  const medications = (data ?? []) as MedicationRow[];
  const isOwner = activePatient?.role === "owner";
  // Owners and caregivers can log doses (PRD §5.6); viewers cannot.
  const canLog =
    activePatient?.role === "owner" || activePatient?.role === "caregiver";

  // Drug interaction check: which medications have known interactions? (PRD §5.8)
  // Build a set of drug IDs that have at least one interaction with another
  // active medication on this patient.
  const drugIds = medications
    .map((m) => m.canonical_drug_id)
    .filter((id): id is string => Boolean(id));
  const medsWithInteractions = new Set<string>();

  if (drugIds.length >= 2) {
    // Query all interactions involving any pair of the patient's drug IDs.
    const { data: ixRows } = await supabase
      .from("drug_interactions")
      .select("drug_a_id, drug_b_id")
      .in("drug_a_id", drugIds)
      .in("drug_b_id", drugIds);

    const drugIdToMedIds = new Map<string, string[]>();
    for (const m of medications) {
      if (m.canonical_drug_id) {
        const arr = drugIdToMedIds.get(m.canonical_drug_id) ?? [];
        arr.push(m.id);
        drugIdToMedIds.set(m.canonical_drug_id, arr);
      }
    }

    for (const row of ixRows ?? []) {
      const aMeds = drugIdToMedIds.get(row.drug_a_id as string) ?? [];
      const bMeds = drugIdToMedIds.get(row.drug_b_id as string) ?? [];
      for (const id of aMeds) medsWithInteractions.add(id);
      for (const id of bMeds) medsWithInteractions.add(id);
    }
  }

  // Latest log per medication, for the neutral "last logged" line (PRD §9).
  // RLS scopes these to medications the caller may read.
  const { data: logRows } = await supabase
    .from("dose_logs")
    .select("medication_id, logged_at")
    .order("logged_at", { ascending: false });
  const lastLogged = new Map<string, string>();
  for (const r of logRows ?? []) {
    if (!lastLogged.has(r.medication_id)) {
      lastLogged.set(r.medication_id, r.logged_at);
    }
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-base font-medium tracking-tight">
              Doozy<span className="text-accent"> Health</span>
            </span>
            {activePatient ? (
              allPatients.length > 1 ? (
                <span className="text-sm">
                  · <PatientSwitcher patients={allPatients} activeId={activePatient.id} />
                </span>
              ) : (
                <span className="text-sm text-muted">
                  · {activePatient.name}
                  {activePatient.role !== "owner" ? (
                    <span className="ml-1 text-faint">({activePatient.role})</span>
                  ) : null}
                </span>
              )
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/settings" className="text-faint hover:text-muted">
              Settings
            </Link>
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
        {/* Pending invites (PRD §4.5) */}
        {pendingInvites.length > 0 ? (
          <section className="mb-8 rounded-md border border-yellow-900 bg-yellow-950/10 p-4 space-y-3">
            <h2 className="text-sm font-medium text-paper">Pending invites</h2>
            {pendingInvites.map((inv) => {
              const mId = pendingMembershipIds.get(inv.patientId);
              return (
                <div
                  key={inv.patientId}
                  className="flex items-center justify-between gap-3"
                >
                  <p className="text-sm text-muted">
                    <span className="text-paper">{inv.patientName}</span> — invited
                    as {inv.role}
                  </p>
                  {mId ? (
                    <div className="flex gap-2">
                      <form action={acceptInvite}>
                        <input type="hidden" name="membership_id" value={mId} />
                        <button
                          type="submit"
                          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-ink hover:opacity-90"
                        >
                          Accept
                        </button>
                      </form>
                      <form action={declineInvite}>
                        <input type="hidden" name="membership_id" value={mId} />
                        <button
                          type="submit"
                          className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:bg-surface"
                        >
                          Decline
                        </button>
                      </form>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        ) : null}

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
              const last = lastLogged.get(m.id);
              return (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-4 px-4 py-4"
                >
                  <Link
                    href={`/medications/${m.id}`}
                    className="min-w-0 flex-1 transition-colors hover:opacity-80"
                  >
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
                      {medsWithInteractions.has(m.id) ? (
                        <span
                          className="ml-2 align-middle rounded-full bg-yellow-950 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400"
                          title="Known interaction — view details"
                        >
                          interaction
                        </span>
                      ) : null}
                    </p>
                    {chosen ? (
                      <p className="mt-0.5 tabular text-sm text-muted">
                        {formatRegimenSummary(chosen)}
                      </p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-faint">
                      {last ? `Last logged ${relativeAge(last)}` : "No doses logged yet"}
                    </p>
                  </Link>
                  {canLog && chosen ? (
                    <form action={logScheduledDose} className="shrink-0">
                      <input type="hidden" name="medication_id" value={m.id} />
                      <input type="hidden" name="return_to" value="/dashboard" />
                      <button
                        type="submit"
                        className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90"
                      >
                        Taken
                      </button>
                    </form>
                  ) : null}
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
