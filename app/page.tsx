import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-medium tracking-tight">
          Doozy<span className="text-accent"> Health</span>
        </h1>
        <p className="mt-3 text-sm text-muted">
          A wellness diary for tracking your medications and how you feel.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-block rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
