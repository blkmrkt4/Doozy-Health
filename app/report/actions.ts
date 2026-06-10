"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buildReportData } from "@/lib/report/report-data";
import { generateReportNarrative, type ClinicalNarrative } from "@/lib/report/narrative";

// Server action behind the report's "Generate summary" button (PRD §5.10.1).
// Runs the LLM ONCE and caches the narrative in report_summaries so the HTML
// report and the Puppeteer PDF both read the same text without re-billing the
// model. Owners + caregivers may generate; viewers cannot (write model §5.6,
// enforced again by RLS on the table).

export type GenerateSummaryResult =
  | { ok: true; narrative: ClinicalNarrative; generatedAt: string }
  | { ok: false; error: string };

/** Stable hash of the facts so the UI can detect a stale cached summary. */
function factsHash(facts: unknown): string {
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex").slice(0, 32);
}

export async function generateClinicalSummary(
  patientId: string,
  from: string,
  to: string
): Promise<GenerateSummaryResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Owner or caregiver only — mirrors the RLS write policy on the table.
  const { data: membership } = await supabase
    .from("patient_memberships")
    .select("role")
    .eq("patient_id", patientId)
    .single();
  if (!membership) return { ok: false, error: "No access to this patient." };
  if (membership.role === "viewer") {
    return { ok: false, error: "Viewers cannot generate summaries." };
  }

  const data = await buildReportData(supabase, patientId, from, to);
  const { narrative, modelUsed } = await generateReportNarrative(data.facts);

  const { error } = await supabase.from("report_summaries").upsert(
    {
      patient_id: patientId,
      from_date: from,
      to_date: to,
      facts_hash: factsHash(data.facts),
      summary: narrative,
      model_used: modelUsed,
      generated_by_user_id: user.id,
    },
    { onConflict: "patient_id,from_date,to_date" }
  );
  if (error) return { ok: false, error: "Could not save the summary. Please try again." };

  revalidatePath(`/report/${patientId}`);
  return { ok: true, narrative, generatedAt: new Date().toISOString() };
}
