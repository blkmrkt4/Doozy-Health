import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sendMagicLink, devSignIn } from "./actions";

const DEV_AUTH_BYPASS = process.env.NODE_ENV !== "production";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const sent = params.sent === "1";

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-medium tracking-tight">
          Doozy<span className="text-accent"> Health</span>
        </h1>
        <p className="mt-1 text-sm text-faint">Sign in to continue.</p>

        {sent ? (
          <div className="mt-8 rounded-md border border-line bg-surface p-4 text-sm text-muted">
            We have sent you a sign-in link. Open the email on this device and
            tap the link to continue.
          </div>
        ) : (
          <form action={sendMagicLink} className="mt-8 space-y-3">
            <label className="block text-sm text-muted">
              Email
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                inputMode="email"
                className="mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-paper outline-none focus:border-accent"
              />
            </label>
            {params.next ? (
              <input type="hidden" name="next" value={params.next} />
            ) : null}
            <button
              type="submit"
              className="block w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90"
            >
              Send sign-in link
            </button>
            {params.error ? (
              <p className="text-sm text-red-400">{params.error}</p>
            ) : null}
          </form>
        )}

        {DEV_AUTH_BYPASS ? (
          <form action={devSignIn} className="mt-6 border-t border-line pt-4">
            {params.next ? (
              <input type="hidden" name="next" value={params.next} />
            ) : null}
            <input type="hidden" name="email" value="blkmrkt.runner@gmail.com" />
            <button
              type="submit"
              className="block w-full rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-medium text-muted transition-opacity hover:opacity-90"
            >
              Dev: instant sign-in
            </button>
            <p className="mt-2 text-xs text-faint">
              Local only — skips email. Hidden in production builds.
            </p>
          </form>
        ) : null}
      </div>
    </main>
  );
}
