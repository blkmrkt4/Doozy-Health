"use client";

import { useEffect, useState } from "react";

// Privacy-mode toggle (PRD §9). Single-tap blur of medication names and
// dose amounts for over-shoulder situations. State persisted in localStorage.

const STORAGE_KEY = "doozy_privacy_mode";

export function PrivacyToggle() {
  const [active, setActive] = useState(false);

  // Sync with localStorage and apply/remove the body class.
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) === "true";
    setActive(stored);
    if (stored) {
      document.body.classList.add("privacy-mode");
    }
  }, []);

  function toggle() {
    const next = !active;
    setActive(next);
    localStorage.setItem(STORAGE_KEY, String(next));
    if (next) {
      document.body.classList.add("privacy-mode");
    } else {
      document.body.classList.remove("privacy-mode");
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`rounded-md border px-2 py-1 text-xs transition-colors ${
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-line text-faint hover:text-muted"
      }`}
      title={active ? "Privacy mode on — tap to show" : "Privacy mode off — tap to blur"}
    >
      {active ? "Show" : "Hide"}
    </button>
  );
}
