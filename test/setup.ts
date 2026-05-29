import { config } from "dotenv";

// Load the local Supabase connection details written by `supabase start`
// (see .env.local). Tests run against the local stack only — never a remote
// project, and (per PRD §15) never against live OpenRouter.
config({ path: ".env.local" });
