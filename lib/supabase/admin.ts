import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

// Service-role client. Bypasses RLS. Server-side only — `import 'server-only'`
// makes Next.js fail the build if this file ever leaks into a client bundle.
export function createAdminClient() {
  const env = serverEnv();
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
