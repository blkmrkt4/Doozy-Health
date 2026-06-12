import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { consumedFromLogs, projectRunOut, type Conc, type RunOut } from "@/lib/supply";
import { isFrequency } from "@/lib/types";

// One shared run-out projection for a medication (PRD §5.3): package count on
// the newest fill minus what's actually been logged since that fill, at the
// chosen cadence. Used by the medication detail page AND the post-dose-log
// notification evaluator, so the two can't drift. Deterministic TS, no LLM.

export type DeliveryFormSupplyRow = {
  id: string;
  package_count: string | number | null;
  package_unit: string | null;
  concentration: unknown;
  created_at: string;
};

export type ChosenRegimenSupplyRow = {
  dose_amount: string | number;
  dose_unit: string;
  frequency: unknown;
};

/**
 * Project remaining supply for one medication from its newest delivery form and
 * active chosen regimen (caller provides both, already RLS-loaded). Queries the
 * taken/prn logs since the fill. Returns null when there's nothing to project
 * (no package count, or no structured cadence).
 */
export async function loadMedicationRunOut(
  supabase: SupabaseClient,
  medicationId: string,
  delivery: DeliveryFormSupplyRow | null,
  chosen: ChosenRegimenSupplyRow | null,
  now: number = Date.now()
): Promise<RunOut | null> {
  if (!delivery?.package_count || !chosen || !isFrequency(chosen.frequency)) {
    return null;
  }

  const { data: supplyLogs } = await supabase
    .from("dose_logs")
    .select("amount, unit")
    .eq("medication_id", medicationId)
    .in("event_type", ["taken", "prn"])
    .not("amount", "is", null)
    .gte("logged_at", delivery.created_at);

  const concentration = (delivery.concentration ?? null) as Conc;
  const consumed = consumedFromLogs(
    supplyLogs ?? [],
    chosen.dose_unit,
    delivery.package_unit,
    concentration
  );

  return projectRunOut({
    packageCount: Number(delivery.package_count),
    packageUnit: delivery.package_unit,
    concentration,
    regimen: {
      doseAmount: Number(chosen.dose_amount),
      doseUnit: chosen.dose_unit,
      frequency: chosen.frequency,
    },
    consumed,
    now,
  });
}
