"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/login/actions";

// Hybrid responsive navigation (PRD §9; mobile-first).
//   • Large screens → a permanent horizontal top bar of primary items.
//   • iOS / small screens → a fixed bottom Tab Bar for the primary items plus a
//     slide-out Sidebar (the hamburger) for the secondary account actions.
// Every tap target is at least 44×44 (Apple HIG). Uses our semantic theme
// tokens so it adapts to light/dark. Rendered globally from the root layout and
// self-hides on the public, print, and admin routes. American English.

type Key =
  | "dashboard"
  | "diary"
  | "add"
  | "export"
  | "notifications"
  | "settings";

const icons: Record<string, ReactNode> = {
  dashboard: (
    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 4l9 5.5v7.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9.5z" />
      <path d="M9 22V12h6v10" />
    </svg>
  ),
  diary: (
    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z" />
      <path d="M8 3v18M11 8h4M11 12h4" />
    </svg>
  ),
  add: (
    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  ),
  export: (
    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5M12 15V3" />
    </svg>
  ),
  notifications: (
    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2z" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  settings: (
    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  menu: (
    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  ),
  close: (
    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  account: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  ),
  eye: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  home: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 4l9 5.5v7.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9.5z" />
    </svg>
  ),
  signout: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  ),
  users: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" />
    </svg>
  ),
  box: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </svg>
  ),
  sliders: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h11M19 6h1M4 12h5M13 12h7M4 18h9M17 18h3" />
      <circle cx="17" cy="6" r="2" /><circle cx="11" cy="12" r="2" /><circle cx="15" cy="18" r="2" />
    </svg>
  ),
};

// `short` is the compact label for the iPhone tab bar (the full one is used on
// the desktop bar and for accessibility).
const PRIMARY: {
  key: Key;
  label: string;
  short?: string;
  href: string;
  accent?: boolean;
}[] = [
  { key: "dashboard", label: "Dashboard", short: "Home", href: "/dashboard" },
  { key: "diary", label: "Diary", href: "/diary" },
  { key: "add", label: "Add", href: "/medications/new", accent: true },
  { key: "export", label: "Export", href: "/report" },
  { key: "notifications", label: "Notifications", short: "Alerts", href: "/notifications" },
  { key: "settings", label: "Settings", href: "/settings" },
];

function activeKey(pathname: string): Key | null {
  if (pathname === "/dashboard") return "dashboard";
  if (pathname.startsWith("/diary")) return "diary";
  if (pathname.startsWith("/medications/new") || pathname.startsWith("/inventory/new"))
    return "add";
  if (pathname.startsWith("/report") || pathname === "/settings/export")
    return "export";
  if (pathname.startsWith("/notifications")) return "notifications";
  if (pathname.startsWith("/settings")) return "settings";
  return null;
}

// Public / focused routes that get no app chrome.
function hidden(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/welcome" ||
    pathname === "/login" ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/report/") // the print/PDF page (keeps the /report builder)
  );
}

const PRIVACY_KEY = "doozy_privacy_mode";

export function AppNav({
  userEmail,
  isOwner,
}: {
  userEmail: string | null;
  isOwner: boolean;
}) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const [privacy, setPrivacy] = useState(false);

  const shown = Boolean(userEmail) && !hidden(pathname);

  // Pad the page so the fixed mobile tab bar never covers content.
  useEffect(() => {
    document.body.classList.toggle("nav-offset", shown);
    return () => document.body.classList.remove("nav-offset");
  }, [shown]);

  // Restore privacy-mode (mirrors PrivacyToggle's key + body class).
  useEffect(() => {
    const on = localStorage.getItem(PRIVACY_KEY) === "true";
    setPrivacy(on);
    document.body.classList.toggle("privacy-mode", on);
  }, []);

  // Close the drawer whenever the route changes.
  useEffect(() => setOpen(false), [pathname]);

  // While the drawer is open: lock background scroll and allow Escape to close.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!shown) return null;

  const current = activeKey(pathname);

  function togglePrivacy() {
    const next = !privacy;
    setPrivacy(next);
    localStorage.setItem(PRIVACY_KEY, String(next));
    document.body.classList.toggle("privacy-mode", next);
  }

  const wordmark = (
    <Link
      href="/welcome"
      className="text-[1.2rem] font-medium tracking-tight transition-opacity hover:opacity-80"
      aria-label="WellKept welcome page"
    >
      WellKept<span className="text-accent text-[1.4em] leading-none">.</span>
    </Link>
  );

  return (
    <>
      {/* ── Top bar (sticky) ─────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-40 border-b border-line bg-ink/95 backdrop-blur"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-3 sm:px-4">
          {/* hamburger → secondary menu. Left-aligned so it matches the
              drawer, which slides in from the left. */}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            title="Menu"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-line text-muted transition-colors hover:bg-surface hover:text-paper"
          >
            {icons.menu}
          </button>

          {wordmark}

          {/* primary nav — large screens. Each item is an icon-only square that
              expands its label on hover; the active (current) item flips to a
              filled pill (icon + label) while the others collapse to icons. */}
          <nav className="hidden items-center gap-1 rounded-2xl border border-line p-1 lg:ml-3 lg:flex">
            {PRIMARY.map((item, i) => {
              const isActive = current === item.key;
              // Active = inverted fill. Inactive = transparent, fills on hover.
              const container = isActive
                ? "border-paper bg-paper text-ink font-medium"
                : "border-transparent text-muted hover:bg-surface hover:text-paper";
              // The accent action keeps its tint until it's the active pill.
              const iconTone = isActive
                ? ""
                : item.accent
                  ? "text-accent"
                  : "";
              const labelState = isActive
                ? "ml-2 max-w-[9rem] opacity-100"
                : "ml-0 max-w-0 opacity-0 group-hover:ml-2 group-hover:max-w-[9rem] group-hover:opacity-100";
              return (
                <Fragment key={item.key}>
                  {i === 1 ? <span className="mx-1 h-6 w-px bg-line" /> : null}
                  <Link
                    href={item.href}
                    aria-label={item.label}
                    title={item.label}
                    aria-current={isActive ? "page" : undefined}
                    className={`group inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border px-2.5 transition-colors ${container}`}
                  >
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center ${iconTone}`}>
                      {icons[item.key]}
                    </span>
                    <span
                      className={`overflow-hidden whitespace-nowrap text-sm font-medium transition-all duration-300 ${labelState}`}
                    >
                      {item.label}
                    </span>
                  </Link>
                </Fragment>
              );
            })}
          </nav>
        </div>
      </header>

      {/* ── Bottom tab bar (small screens) ───────────────────────────────── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink/95 backdrop-blur lg:hidden"
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
        aria-label="Primary"
      >
        <div className="mx-auto flex max-w-md items-stretch px-1">
          {PRIMARY.map((item) => {
            const isActive = current === item.key;
            const tone = item.accent
              ? "text-accent"
              : isActive
                ? "text-paper"
                : "text-faint";
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 transition-colors ${tone}`}
              >
                <span className="flex items-center justify-center">{icons[item.key]}</span>
                <span className="max-w-full truncate text-[10px] leading-none">
                  {item.short ?? item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* ── Slide-out sidebar (secondary) ────────────────────────────────── */}
      <div
        className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
        aria-hidden={!open}
      >
        <button
          type="button"
          tabIndex={open ? 0 : -1}
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
        />
        <aside
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[82vw] flex-col border-r border-line bg-ink transition-transform duration-300 ${open ? "translate-x-0" : "-translate-x-full"}`}
          style={{
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          <div className="flex items-center justify-between px-4 py-3">
            {wordmark}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface hover:text-paper"
            >
              {icons.close}
            </button>
          </div>

          {/* signed-in identity */}
          <Link
            href="/settings/account"
            onClick={() => setOpen(false)}
            className="mx-3 flex items-center gap-3 rounded-xl border border-line px-3 py-2 transition-colors hover:bg-surface"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
              {icons.account}
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] text-faint">Signed in as</span>
              <span className="block truncate text-sm text-paper blur-private">
                {userEmail}
              </span>
            </span>
          </Link>

          <div className="mt-2 flex-1 space-y-1 overflow-y-auto px-3">
            {isOwner ? (
              <SidebarLink href="/inventory/new" icon={icons.box} label="Add a supply" onClick={() => setOpen(false)} />
            ) : null}
            {isOwner ? (
              <SidebarLink href="/settings/caregivers" icon={icons.users} label="Caregivers" onClick={() => setOpen(false)} />
            ) : null}
            {isOwner ? (
              <SidebarLink href="/settings/tracking" icon={icons.sliders} label="Diary tracking fields" onClick={() => setOpen(false)} />
            ) : null}

            <button
              type="button"
              onClick={togglePrivacy}
              className="flex w-full items-center justify-between rounded-xl px-3 text-sm text-muted transition-colors hover:bg-surface hover:text-paper"
              style={{ minHeight: 44 }}
            >
              <span className="flex items-center gap-3">
                <span className="flex w-5 items-center justify-center">{icons.eye}</span>
                {privacy ? "Show values" : "Hide values"}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] ${privacy ? "border-accent text-accent" : "border-line text-faint"}`}
              >
                {privacy ? "Hidden" : "Visible"}
              </span>
            </button>

            <SidebarLink href="/welcome" icon={icons.home} label="Landing page" onClick={() => setOpen(false)} />
          </div>

          <form action={signOut} className="border-t border-line p-3">
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-xl px-3 text-sm text-muted transition-colors hover:bg-surface hover:text-paper"
              style={{ minHeight: 44 }}
            >
              <span className="flex w-5 items-center justify-center">{icons.signout}</span>
              Sign out
            </button>
          </form>
        </aside>
      </div>
    </>
  );
}

function SidebarLink({
  href,
  icon,
  label,
  onClick,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl px-3 text-sm text-muted transition-colors hover:bg-surface hover:text-paper"
      style={{ minHeight: 44 }}
    >
      <span className="flex w-5 items-center justify-center">{icon}</span>
      {label}
    </Link>
  );
}
