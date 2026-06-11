"use client";

import { useEffect, useState } from "react";

// Dashboard "graphs on/off" toggle. Shows/hides the amount-in-system PK curve on
// every medication card at once; the calendar wheel, dose logging and diary stay
// (only `.med-amount-chart` is hidden via a body class). A personal view
// preference persisted in localStorage — mirrors the privacy-mode mechanism.

const STORAGE_KEY = "doozy_hide_med_charts";
const BODY_CLASS = "med-charts-hidden";

export function ChartsToggle() {
  const [hidden, setHidden] = useState(false);

  // Sync with localStorage and apply/remove the body class on mount.
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) === "true";
    setHidden(stored);
    document.body.classList.toggle(BODY_CLASS, stored);
  }, []);

  function toggle() {
    const next = !hidden;
    setHidden(next);
    localStorage.setItem(STORAGE_KEY, String(next));
    document.body.classList.toggle(BODY_CLASS, next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={!hidden}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
        hidden
          ? "border-line text-faint hover:text-muted"
          : "border-accent bg-accent/10 text-accent"
      }`}
      title={hidden ? "Graphs hidden — tap to show" : "Graphs shown — tap to hide"}
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 3v18h18" />
        <path d="M7 14l3-4 3 3 4-6" />
      </svg>
      Graphs
    </button>
  );
}
