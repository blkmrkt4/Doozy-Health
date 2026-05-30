import { config } from "dotenv";
import { randomBytes } from "node:crypto";

// Load the local Supabase connection details written by `supabase start`
// (see .env.local). Tests run against the local stack only — never a remote
// project, and (per PRD §15) never against live OpenRouter.
config({ path: ".env.local" });

// Ensure SECRET_ENCRYPTION_KEY is set for tests that import lib/env.ts.
// A random key is fine — tests that need encryption use their own keys.
if (!process.env.SECRET_ENCRYPTION_KEY) {
  process.env.SECRET_ENCRYPTION_KEY = randomBytes(32).toString("hex");
}
