"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Dev-only: true unless we are running a production build. Used to gate the
// instant-login bypass so it can never be reached in a deployed environment.
const DEV_AUTH_BYPASS = process.env.NODE_ENV !== "production";

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const next =
    String(formData.get("next") ?? "/dashboard").trim() || "/dashboard";

  if (!email) {
    redirect(`/login?error=${encodeURIComponent("Email is required.")}`);
  }

  const supabase = await createClient();
  const hdrs = await headers();
  const host =
    hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "localhost:3000";
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${host}`;

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/login?sent=1");
}

// Dev-only instant login. Skips the email + Inbucket round trip while testing:
// the service-role admin client mints a real magic-link token which we consume
// immediately, so the resulting session is a legitimate Supabase JWT — the same
// auth path, minus the email hop. Hard-refuses outside a dev build.
export async function devSignIn(formData: FormData) {
  if (!DEV_AUTH_BYPASS) {
    redirect(`/login?error=${encodeURIComponent("Dev bypass is disabled.")}`);
  }

  const email =
    String(formData.get("email") ?? "").trim() || "blkmrkt.runner@gmail.com";
  const next =
    String(formData.get("next") ?? "/dashboard").trim() || "/dashboard";

  const admin = createAdminClient();

  // Ensure the user exists (the signup trigger provisions profile + patient).
  // Ignore the "already registered" conflict on repeat logins.
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createError && !/already|registered|exists/i.test(createError.message)) {
    redirect(`/login?error=${encodeURIComponent(createError.message)}`);
  }

  // Mint a magic-link token, then consume it against the cookie-bound client so
  // the session lands in this browser's cookies.
  const { data, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !data.properties?.hashed_token) {
    redirect(
      `/login?error=${encodeURIComponent(
        linkError?.message ?? "Could not generate dev sign-in token."
      )}`
    );
  }

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "email",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) {
    redirect(`/login?error=${encodeURIComponent(verifyError.message)}`);
  }

  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
