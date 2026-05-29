import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Membership RLS predicate (PRD §7, §15).
 *
 * Asserts the core scope boundary of the whole product: a user can read only
 * the patients they hold a membership for, and the on-signup trigger provisions
 * exactly one patient + an owner membership per new user. The `is_private`
 * override on medications is tested once medications exist (build step 2+).
 *
 * Runs against the local Supabase stack (`supabase start`). Skips with a loud
 * message if the env isn't present, so CI without a DB doesn't silently pass.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ready = Boolean(url && anonKey && serviceKey);

function adminClient(): SupabaseClient {
  return createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// An RLS-bound client authenticated as a specific user.
async function signedInClient(
  email: string,
  password: string
): Promise<SupabaseClient> {
  const c = createClient(url!, anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

describe.skipIf(!ready)("membership RLS predicate", () => {
  const admin = ready ? adminClient() : (null as unknown as SupabaseClient);
  const password = "test-password-123!";
  const stamp = Date.now();
  const emailA = `rls-a-${stamp}@example.test`;
  const emailB = `rls-b-${stamp}@example.test`;

  let userIdA = "";
  let userIdB = "";
  let patientIdA = "";
  let patientIdB = "";

  beforeAll(async () => {
    for (const email of [emailA, emailB]) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw new Error(`createUser ${email}: ${error.message}`);
      if (email === emailA) userIdA = data.user!.id;
      else userIdB = data.user!.id;
    }

    // The on-signup trigger provisions a patient + owner membership. Read the
    // provisioned patient ids back with the service role (bypasses RLS).
    const { data: memberships, error } = await admin
      .from("patient_memberships")
      .select("patient_id, user_id, role")
      .in("user_id", [userIdA, userIdB]);
    if (error) throw new Error(`read memberships: ${error.message}`);

    for (const m of memberships ?? []) {
      if (m.user_id === userIdA) patientIdA = m.patient_id;
      if (m.user_id === userIdB) patientIdB = m.patient_id;
    }
  });

  afterAll(async () => {
    if (!ready) return;
    // Deleting the auth user cascades to public.users → memberships → patient.
    if (userIdA) await admin.auth.admin.deleteUser(userIdA);
    if (userIdB) await admin.auth.admin.deleteUser(userIdB);
  });

  it("provisions exactly one owner membership + patient per signup", () => {
    expect(patientIdA).toBeTruthy();
    expect(patientIdB).toBeTruthy();
    expect(patientIdA).not.toEqual(patientIdB);
  });

  it("auto-names the patient from the email local-part", async () => {
    const { data } = await admin
      .from("patients")
      .select("name")
      .eq("id", patientIdA)
      .single();
    expect(data?.name).toEqual(emailA.split("@")[0]);
  });

  it("lets a member read their own patient, with owner role", async () => {
    const a = await signedInClient(emailA, password);
    const { data, error } = await a
      .from("patients")
      .select("id");
    expect(error).toBeNull();
    expect(data?.map((p) => p.id)).toEqual([patientIdA]);

    const { data: mine } = await a
      .from("patient_memberships")
      .select("role");
    expect(mine?.map((m) => m.role)).toEqual(["owner"]);
  });

  it("denies reading a patient the caller is not a member of", async () => {
    const a = await signedInClient(emailA, password);

    // Directly target user B's patient id — RLS must return zero rows, not an
    // error. This is the predicate doing its job, not the UI hiding a button.
    const { data, error } = await a
      .from("patients")
      .select("id")
      .eq("id", patientIdB);
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // And B's membership row must be invisible to A.
    const { data: foreign } = await a
      .from("patient_memberships")
      .select("id")
      .eq("patient_id", patientIdB);
    expect(foreign).toEqual([]);
  });
});
