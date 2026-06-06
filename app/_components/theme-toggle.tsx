"use client";

import { useEffect, useState } from "react";

// Light/dark theme switch. The actual theme is applied before paint by the
// inline script in the root layout (no flash); this control just flips the
// <html data-theme> attribute and remembers the choice. Placed in the global
// footer so it's reachable from every screen — readers who prefer light type
// shouldn't have to hunt for it.

type Theme = "light" | "dark";

function current(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

export function ThemeToggle() {
  // Render nothing meaningful until mounted — the server can't know the
  // runtime theme (it's set by the pre-paint script), so we avoid a mismatch.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => setTheme(current()), []);

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
      className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-surface"
    >
      <span aria-hidden className="text-sm leading-none">
        {/* Stable placeholder before mount keeps the footer from shifting. */}
        {theme === null ? "◐" : isLight ? "☾" : "☀"}
      </span>
      <span>{theme === null ? "Theme" : isLight ? "Dark" : "Light"}</span>
    </button>
  );
}
