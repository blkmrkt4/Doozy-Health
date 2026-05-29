import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

const ACTIVE_PATIENT_COOKIE = "active_patient";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export type ActivePatient = {
  id: string;
  name: string;
  role: "owner" | "caregiver" | "viewer";
};

type MembershipRow = {
  patient_id: string;
  role: ActivePatient["role"];
  patients: { name: string } | { name: string }[] | null;
};

function patientName(row: MembershipRow): string {
  const p = Array.isArray(row.patients) ? row.patients[0] : row.patients;
  return p?.name ?? "Patient";
}

/**
 * Resolve the active patient for the signed-in caller.
 *
 * The active patient is application session state (PRD §7), carried in a
 * cookie and re-validated against the caller's membership set on every read —
 * a stale or forged cookie can never select a patient the user isn't a member
 * of. There is deliberately no "current patient" at the database layer and no
 * `current_patient_id()` helper (CLAUDE.md hard rule #5); the membership RLS
 * predicate is the only scope boundary.
 *
 * Pass an RLS-bound client (server component / route client), not the
 * service-role admin client — the query relies on RLS to restrict rows to the
 * caller's own memberships.
 */
export async function getActivePatient(
  supabase: SupabaseClient
): Promise<ActivePatient | null> {
  const { data } = await supabase
    .from("patient_memberships")
    .select("patient_id, role, patients(name)")
    .order("created_at", { ascending: true });

  const memberships = (data ?? []) as MembershipRow[];
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const requested = cookieStore.get(ACTIVE_PATIENT_COOKIE)?.value;

  // Cookie wins only if it names a patient the caller is actually a member of;
  // otherwise default to an owned patient, then the earliest membership.
  const chosen =
    memberships.find((m) => m.patient_id === requested) ??
    memberships.find((m) => m.role === "owner") ??
    memberships[0];

  return {
    id: chosen.patient_id,
    name: patientName(chosen),
    role: chosen.role,
  };
}

/**
 * Switch the active patient. Validates membership against the RLS-bound client
 * before writing the cookie, so the session can only ever point at a patient
 * the caller can see. Wired to the patient switcher UI in build step 13.
 */
export async function setActivePatient(
  supabase: SupabaseClient,
  patientId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("patient_memberships")
    .select("patient_id")
    .eq("patient_id", patientId)
    .maybeSingle();

  if (!data) return false;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_PATIENT_COOKIE, patientId, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });
  return true;
}
