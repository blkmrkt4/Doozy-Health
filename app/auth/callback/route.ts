import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";

// Magic-link / OAuth callback. Exchanges the code for a session and writes the
// auth cookies onto the redirect response itself. We build the client against
// this response (not next/headers) because cookies set via next/headers don't
// reliably attach to a manually-created NextResponse.redirect in a route
// handler — which silently drops the session and loops the user back to login.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";

  const fail = (message: string) =>
    NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(message)}`, url.origin)
    );

  if (!code) return fail("Missing sign-in code.");

  const response = NextResponse.redirect(new URL(next, url.origin));

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail(error.message);

  return response;
}
