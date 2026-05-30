import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { syncModels } from "@/lib/models";

// One-off / scheduled OpenRouter model catalogue sync (PRD §14.3, §14.5).
// Run with:
//   npm run sync:models
//
// Uses the service-role key to bypass RLS on the openrouter_models table.
// NOTE: we deliberately do not use lib/supabase/admin.ts here (it imports
// "server-only" which is a build-time guard for Next.js bundles, not scripts).

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const result = await syncModels(admin);
console.log(
  `Synced ${result.total} models (${result.upserted} upserted, ` +
    `${result.deactivated} deactivated).`
);
