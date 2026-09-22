"use client";

import { useEffect, useState } from "react";

// Light/dark theme switch. The actual theme is applied before paint by the
// inline script in the root layout (no flash); this control just flips the
// <html data-theme> attribute and remembers the choice. The header and footer
// controls observe the same attribute so their labels always stay in sync.

type Theme = "light" | "dark";

function current(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  // Render nothing meaningful until mounted — the server can't know the
  // runtime theme (it's set by the pre-paint script), so we avoid a mismatch.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const sync = () => setTheme(current());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  function toggle() {
    const next: Theme = current() === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private mode / blocked storage — the choice just won't persist.
    }
    setTheme(next);
  }

  const isLight = theme === "light";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={
        theme === null
          ? "Toggle light or dark theme"
          : `Switch to ${isLight ? "dark" : "light"} theme`
      }
      title={theme === null ? "Toggle light or dark theme" : `Switch to ${isLight ? "dark" : "light"} theme`}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 border border-line text-paper transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper ${compact ? "rounded-xl px-3 text-sm" : "rounded-md px-2.5 text-xs"}`}
    >
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        {theme === null ? (
          <><circle cx="12" cy="12" r="8" /><path d="M12 4v16" /></>
        ) : isLight ? (
          <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
        ) : (
          <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
        )}
      </svg>
      <span>{theme === null ? "Theme" : isLight ? "Dark" : "Light"}</span>
    </button>
  );
}
