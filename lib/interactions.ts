import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { llmCall } from "@/lib/llm";

// Drug interaction checking (PRD §5.8, §13.14). Pairwise check against
// curated drug_interactions table. The LLM NEVER enumerates interactions
// (CLAUDE.md hard rule #9) — it only renders records we already hold.

export type InteractionRecord = {
  id: string;
  severity: "info" | "caution" | "serious";
  mechanism: string;
  referenceSource: string;
  otherDrugId: string;
  otherDrugName: string;
};

/**
 * Check for curated drug interactions between a given drug and all other
 * active medications for a patient. Returns an array of interaction records.
 *
 * Uses the RLS-bound client so the query respects patient membership and
 * medication privacy.
 */
export async function checkInteractions(
  supabase: SupabaseClient,
  patientId: string,
  drugId: string
): Promise<InteractionRecord[]> {
  // Load all other active medications' drug IDs for this patient.
  const { data: meds } = await supabase
    .from("medications")
    .select("canonical_drug_id, display_name")
    .eq("patient_id", patientId)
    .eq("archived", false)
    .not("canonical_drug_id", "is", null);

  const otherDrugs = (meds ?? [])
    .filter((m) => m.canonical_drug_id && m.canonical_drug_id !== drugId)
    .map((m) => ({
      drugId: m.canonical_drug_id as string,
      displayName: m.display_name as string,
    }));

  if (otherDrugs.length === 0) return [];

  const otherDrugIds = otherDrugs.map((d) => d.drugId);
  const nameByDrugId = new Map(otherDrugs.map((d) => [d.drugId, d.displayName]));

  // Query interactions in both pair orderings (drug_a_id/drug_b_id are
  // stored in deterministic order, but we need to check both positions).
  const { data: interactionsA } = await supabase
    .from("drug_interactions")
    .select("id, drug_a_id, drug_b_id, severity, mechanism, reference_source")
    .eq("drug_a_id", drugId)
    .in("drug_b_id", otherDrugIds);

  const { data: interactionsB } = await supabase
    .from("drug_interactions")
    .select("id, drug_a_id, drug_b_id, severity, mechanism, reference_source")
    .eq("drug_b_id", drugId)
    .in("drug_a_id", otherDrugIds);

  const results: InteractionRecord[] = [];

  for (const row of [...(interactionsA ?? []), ...(interactionsB ?? [])]) {
    const otherDrugId =
      (row.drug_a_id as string) === drugId
        ? (row.drug_b_id as string)
        : (row.drug_a_id as string);

    results.push({
      id: row.id as string,
      severity: row.severity as InteractionRecord["severity"],
      mechanism: row.mechanism as string,
      referenceSource: row.reference_source as string,
      otherDrugId,
      otherDrugName: nameByDrugId.get(otherDrugId) ?? "Unknown",
    });
  }

  // Sort: serious first, then caution, then info.
  const order = { serious: 0, caution: 1, info: 2 };
  results.sort((a, b) => order[a.severity] - order[b.severity]);

  return results;
}

/**
 * Render a curated interaction record in plain English via the
 * explain_interaction prompt (PRD §14.8). Falls back to the raw mechanism
 * text if the prompt is disabled or the call fails.
 *
 * The LLM does NOT enumerate — it only explains what we pass in (rule #9).
 */
export async function explainInteraction(
  drugAName: string,
  drugBName: string,
  mechanism: string,
  severity: string,
  readingLevel: string = "general"
): Promise<string> {
  const result = await llmCall("explain_interaction", {
    drug_a_name: drugAName,
    drug_b_name: drugBName,
    mechanism,
    severity,
    user_reading_level: readingLevel,
  });

  if (result.ok) return result.text;

  // Fallback: return the raw mechanism text.
  return mechanism;
}
