import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Shared helpers for RLS tests against the local Supabase stack
// (`supabase start`). Never used against a remote project.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const STACK_READY = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY);

export const TEST_PASSWORD = "test-password-123!";

/** Service-role client — bypasses RLS. Used only for setup/teardown. */
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Create a confirmed auth user; the on-signup trigger provisions their
 *  patient + owner membership. Returns the new user id. */
export async function createUser(
  admin: SupabaseClient,
  email: string
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user!.id;
}

/** An RLS-bound client authenticated as the given user. */
export async function signedInClient(
  email: string,
  password = TEST_PASSWORD
): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

/** The owned patient id provisioned for a user by the signup trigger. */
export async function ownedPatientId(
  admin: SupabaseClient,
  userId: string
): Promise<string> {
  const { data, error } = await admin
    .from("patient_memberships")
    .select("patient_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .single();
  if (error) throw new Error(`ownedPatientId: ${error.message}`);
  return data.patient_id;
}
