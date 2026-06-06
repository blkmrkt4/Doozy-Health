import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-xl font-medium tracking-tight">
          Sign-in link problem
        </h1>
        <p className="mt-2 text-sm text-faint">
          That sign-in link could not be used. It may have expired or already
          been opened.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-block rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
