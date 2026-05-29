import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { syncDrugs } from "@/lib/drug-sync";

// One-off / scheduled reference-drug sync (PRD §13.3). Run with:
//   npm run sync:drugs
//
// Uses the service-role key (already required app env, not a third-party
// secret) to bypass RLS on the reference tables. Wiring this to a scheduled,
// secret-protected HTTP endpoint is deferred to the admin backend (step 6),
// where system_secrets can hold the cron secret without breaking hard rule #4.
//
// NOTE: ES imports are hoisted, so dotenv runs after them — fine, because no
// imported module reads process.env at import time. We deliberately do not use
// lib/supabase/admin.ts here (it imports "server-only").

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const result = await syncDrugs(admin);
console.log(
  `Synced ${result.drugs} drugs (${result.rxnormMatched} matched RxNorm), ` +
    `${result.interactions} interactions.`
);
