import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DRUG_CATALOGUE,
  INTERACTION_CATALOGUE,
  type CatalogueDrug,
} from "@/lib/drug-catalogue";

// Reference-drug sync (PRD §13.3). Idempotent: upserts the curated catalogue,
// enriching each drug's identity (rxnorm_id) from RxNorm. Pharmacokinetic
// fields stay curated (RxNorm carries none). Interactions are curated ground
// truth (PRD §5.8) — the LLM never enumerates them.
//
// The RxNorm lookup is injected so tests can stub it (no live external calls
// in tests, mirroring the OpenRouter rule in PRD §15). The service-role client
// is required: reference tables have no client write policy, so writes rely on
// RLS bypass.

export type RxcuiLookup = (name: string) => Promise<string | null>;

/** Live RxNorm adapter. Public NIH API, read-only, no key. */
export const rxnormRxcuiLookup: RxcuiLookup = async (name) => {
  const url = `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(
    name
  )}&search=2`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      idGroup?: { rxnormId?: string[] };
    };
    const ids = json.idGroup?.rxnormId;
    return Array.isArray(ids) && ids.length > 0 ? String(ids[0]) : null;
  } catch {
    // A lookup miss is non-fatal — the drug is still upserted with a null
    // rxnorm_id and can be re-enriched on the next sync.
    return null;
  }
};

export type SyncResult = {
  drugs: number;
  interactions: number;
  rxnormMatched: number;
};

function drugRow(d: CatalogueDrug, rxnorm_id: string | null, now: string) {
  return {
    rxnorm_id,
    canonical_name: d.canonical_name,
    atc_class: d.atc_class ?? null,
    half_life_hours: d.half_life_hours,
    half_life_range_hours: d.half_life_range_hours ?? {},
    bioavailability: d.bioavailability ?? {},
    tmax_hours: d.tmax_hours ?? {},
    kernel_by_route: d.kernel_by_route ?? {},
    release_duration_hours: d.release_duration_hours ?? {},
    is_linear: d.is_linear ?? true,
    nonlinear_reason: d.nonlinear_reason ?? null,
    metabolites: d.metabolites ?? null,
    controlled_schedule: d.controlled_schedule ?? null,
    reference_data: d.reference_data ?? {},
    last_synced_at: now,
  };
}

export async function syncDrugs(
  admin: SupabaseClient,
  lookup: RxcuiLookup = rxnormRxcuiLookup,
  now: string = new Date().toISOString()
): Promise<SyncResult> {
  let rxnormMatched = 0;

  // 1) Upsert drugs (identity from RxNorm, PK params curated).
  for (const d of DRUG_CATALOGUE) {
    const rxnorm_id = await lookup(d.canonical_name);
    if (rxnorm_id) rxnormMatched++;
    const { error } = await admin
      .from("drugs")
      .upsert(drugRow(d, rxnorm_id, now), { onConflict: "canonical_name" });
    if (error) {
      throw new Error(`upsert drug ${d.canonical_name}: ${error.message}`);
    }
  }

  // 2) Resolve ids, then upsert interactions with a deterministic pair order.
  const { data: rows, error: readErr } = await admin
    .from("drugs")
    .select("id, canonical_name");
  if (readErr) throw new Error(`read drugs: ${readErr.message}`);
  const idByName = new Map<string, string>(
    (rows ?? []).map((r) => [r.canonical_name as string, r.id as string])
  );

  let interactions = 0;
  for (const it of INTERACTION_CATALOGUE) {
    const aId = idByName.get(it.a);
    const bId = idByName.get(it.b);
    if (!aId || !bId) continue; // skip if either drug isn't in the catalogue
    const [drug_a_id, drug_b_id] = aId < bId ? [aId, bId] : [bId, aId];
    const { error } = await admin.from("drug_interactions").upsert(
      {
        drug_a_id,
        drug_b_id,
        severity: it.severity,
        mechanism: it.mechanism,
        reference_source: "curated",
        last_synced_at: now,
      },
      { onConflict: "drug_a_id,drug_b_id" }
    );
    if (error) throw new Error(`upsert interaction: ${error.message}`);
    interactions++;
  }

  return { drugs: DRUG_CATALOGUE.length, interactions, rxnormMatched };
}
