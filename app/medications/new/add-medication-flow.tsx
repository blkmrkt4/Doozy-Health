"use client";

import { useState } from "react";
import { ScanForm } from "./scan-form";
import { MedicationForm } from "./medication-form";
import { SetupList, type SetupStatus } from "./setup-status";

// Owns the add-medication page below the title so the setup checklist can sit
// at the very top — above the scan box — while still reflecting the manual
// form's live state. The form reports its status up via onStatus; everything
// here is presentation.
export function AddMedicationFlow() {
  const [status, setStatus] = useState<SetupStatus | null>(null);

  return (
    <>
      {/* The glanceable "what this needs" list, right under the page title. */}
      {status ? <SetupList status={status} /> : null}

      <div className="mt-6">
        <ScanForm />
      </div>

      {/* ── Divider ───────────────────────────────────────── */}
      <div className="relative my-8">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-line" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-ink px-3 text-xs text-faint">or enter manually</span>
        </div>
      </div>

      {/* ── Manual-entry path ─────────────────────────────── */}
      <MedicationForm onStatus={setStatus} />
    </>
  );
}
