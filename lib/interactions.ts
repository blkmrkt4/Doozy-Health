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

export type InteractionFact = {
  severity: "info" | "caution" | "serious";
  mechanism: string;
  aLabel: string;
  bLabel: string;
  /** Canonical drug ids for the pair — lets downstream consumers (e.g. the
   *  notifications dedupe key) identify the pair without parsing labels. */
  aDrugId: string;
  bDrugId: string;
  /** True when that side entered the set as a diary-tracked substance
   *  (alcohol/caffeine/nicotine) rather than a medication. */
  aIsSubstance: boolean;
  bIsSubstance: boolean;
};

/**
 * Find every curated interaction among a SET of drugs (the report's whole
 * in-scope set: active medications + tracked substances + ad-hoc OTC meds).
 * Generalizes checkInteractions, which is per-drug. Ground truth is the curated
 * drug_interactions table only — never the LLM (hard rule #9).
 *
 * `items` carries a display label per drug id (e.g. "alcohol (tracked in diary)")
 * plus an optional `kind` marking diary-tracked substances (defaults to
 * "medication"). Pairs are deduped; results are ordered serious → caution → info.
 */
export async function findInteractionsAmong(
  supabase: SupabaseClient,
  items: { drugId: string; label: string; kind?: "medication" | "substance" }[]
): Promise<InteractionFact[]> {
  // Unique drug ids, with a label/kind for each (first entry wins).
  const labelByDrug = new Map<string, string>();
  const kindByDrug = new Map<string, "medication" | "substance">();
  for (const it of items) {
    if (!it.drugId) continue;
    if (!labelByDrug.has(it.drugId)) {
      labelByDrug.set(it.drugId, it.label);
      kindByDrug.set(it.drugId, it.kind ?? "medication");
    }
  }
  const drugIds = [...labelByDrug.keys()];
  if (drugIds.length < 2) return [];

  // Any curated pair where BOTH drugs are in the set.
  const { data: rows } = await supabase
    .from("drug_interactions")
    .select("drug_a_id, drug_b_id, severity, mechanism")
    .in("drug_a_id", drugIds)
    .in("drug_b_id", drugIds);

  const seen = new Set<string>();
  const facts: InteractionFact[] = [];
  for (const row of rows ?? []) {
    const a = row.drug_a_id as string;
    const b = row.drug_b_id as string;
    if (a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({
      severity: row.severity as InteractionFact["severity"],
      mechanism: row.mechanism as string,
      aLabel: labelByDrug.get(a) ?? "Unknown",
      bLabel: labelByDrug.get(b) ?? "Unknown",
      aDrugId: a,
      bDrugId: b,
      aIsSubstance: kindByDrug.get(a) === "substance",
      bIsSubstance: kindByDrug.get(b) === "substance",
    });
  }

  const order = { serious: 0, caution: 1, info: 2 };
  facts.sort((x, y) => order[x.severity] - order[y.severity]);
  return facts;
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
