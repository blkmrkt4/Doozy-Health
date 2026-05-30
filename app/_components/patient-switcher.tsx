"use client";

import { useState } from "react";
import { switchPatient } from "@/app/settings/caregivers/actions";

// Patient switcher (PRD §9, §13.13). Shown in the header when a user has
// more than one patient. One-tap switch via setActivePatient().

type PatientOption = {
  id: string;
  name: string;
  role: "owner" | "caregiver" | "viewer";
};

const roleBadge: Record<string, string> = {
  owner: "",
  caregiver: "caregiver",
  viewer: "viewer",
};

export function PatientSwitcher({
  patients,
  activeId,
}: {
  patients: PatientOption[];
  activeId: string;
}) {
  const [open, setOpen] = useState(false);

  if (patients.length <= 1) return null;

  const active = patients.find((p) => p.id === activeId) ?? patients[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-sm text-muted hover:text-paper"
      >
        <span>{active.name}</span>
        {active.role !== "owner" ? (
          <span className="text-xs text-faint">({roleBadge[active.role]})</span>
        ) : null}
        <span className="text-xs text-faint">▾</span>
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-10 mt-1 min-w-[200px] rounded-md border border-line bg-ink shadow-lg">
          {patients.map((p) => (
            <form key={p.id} action={switchPatient}>
              <input type="hidden" name="patient_id" value={p.id} />
              <button
                type="submit"
                onClick={() => setOpen(false)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface ${
                  p.id === activeId ? "text-accent" : "text-paper"
                }`}
              >
                <span className="flex-1">{p.name}</span>
                {p.role !== "owner" ? (
                  <span className="text-xs text-faint">
                    {roleBadge[p.role]}
                  </span>
                ) : null}
              </button>
            </form>
          ))}
        </div>
      ) : null}
    </div>
  );
}
