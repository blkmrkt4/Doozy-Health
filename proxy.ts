import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 renamed the root "middleware" convention to "proxy". Same role:
// refresh the Supabase session on every request and gate non-public paths
// (PRD §6.2 — magic-link baseline). The matcher skips Next internals and
// static files so this never runs on asset fetches.
export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
