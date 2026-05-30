"use client";

import { useState, useTransition } from "react";
import { explainInteractionAction } from "@/app/medications/actions";

// Drug interaction card (PRD §5.8, §6.1). Shows severity, mechanism, and
// an optional plain-language explanation. Framing is always informational:
// "discuss with your doctor or pharmacist", never "do not take".

type Severity = "info" | "caution" | "serious";

const SEVERITY_STYLES: Record<
  Severity,
  { border: string; badge: string; label: string }
> = {
  serious: {
    border: "border-yellow-800 bg-yellow-950/10",
    badge: "bg-yellow-950 text-yellow-400",
    label: "serious",
  },
  caution: {
    border: "border-line",
    badge: "bg-surface text-muted",
    label: "caution",
  },
  info: {
    border: "border-line",
    badge: "bg-surface text-faint",
    label: "info",
  },
};

export function InteractionCard({
  interactionId,
  drugName,
  otherDrugName,
  severity,
  mechanism,
}: {
  interactionId: string;
  drugName: string;
  otherDrugName: string;
  severity: Severity;
  mechanism: string;
}) {
  const style = SEVERITY_STYLES[severity];
  const [explanation, setExplanation] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleExplain() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("drug_a_name", drugName);
      fd.set("drug_b_name", otherDrugName);
      fd.set("mechanism", mechanism);
      fd.set("severity", severity);
      const text = await explainInteractionAction(fd);
      setExplanation(text);
    });
  }

  return (
    <div className={`rounded-md border p-4 space-y-2 ${style.border}`}>
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${style.badge}`}
        >
          {style.label}
        </span>
        <span className="text-sm text-paper">
          {drugName} + {otherDrugName}
        </span>
      </div>

      <p className="text-xs text-muted">{mechanism}</p>

      {explanation ? (
        <p className="rounded-md bg-surface p-3 text-sm text-paper">
          {explanation}
        </p>
      ) : (
        <button
          type="button"
          onClick={handleExplain}
          disabled={isPending}
          className="text-xs text-accent hover:underline disabled:opacity-50"
        >
          {isPending ? "Explaining..." : "Explain in plain English"}
        </button>
      )}

      <p className="text-[10px] text-faint">
        Discuss with your doctor or pharmacist.
      </p>
    </div>
  );
}
