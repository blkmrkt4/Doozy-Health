import Link from "next/link";
import { requireSystemAdmin } from "@/lib/admin";

// Admin layout — gated by requireSystemAdmin() on every request (PRD §14.1).
// Non-admins receive a 404 (not 403). No caching; no client-side trust.

const NAV_LINKS = [
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/prompts", label: "Prompts" },
  { href: "/admin/extractions", label: "Extractions" },
] as const;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireSystemAdmin();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="mb-8 flex items-center justify-between border-b border-white/10 pb-4">
        <Link href="/admin" className="text-lg font-semibold tracking-tight">
          WellKept Admin
        </Link>
        <nav className="flex gap-4 text-sm">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-white/60 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <span className="text-xs text-white/40">{admin.email}</span>
      </header>
      {children}
    </div>
  );
}
