"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { buildReportData } from "@/lib/report/report-data";
import { generateReportNarrative, type ClinicalNarrative } from "@/lib/report/narrative";
import { onSnapshotGenerated } from "@/lib/notifications-server";
import { logError } from "@/lib/log";

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

  const { data: saved, error } = await supabase
    .from("report_summaries")
    .upsert(
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
    )
    .select("id")
    .single();
  if (error) return { ok: false, error: "Could not save the summary. Please try again." };

  // Notifications from the DETERMINISTIC findings (curated interactions,
  // doses above the regimen on record) — never the narrative. Fire-and-forget:
  // the snapshot already saved, so this must not fail the action.
  try {
    await onSnapshotGenerated({
      patientId,
      reportSummaryId: saved?.id ?? null,
      data,
    });
  } catch (err) {
    logError("notifications", "post-snapshot evaluation failed", err, { patientId });
  }

  revalidatePath(`/report/${patientId}`);
  return { ok: true, narrative, generatedAt: new Date().toISOString() };
}

/**
 * Save the user's "questions for this visit" note for a (patient, range)
 * snapshot. Written independently of the LLM summary — a note never re-bills
 * the model — and rendered verbatim on the report's essentials page. When no
 * summary row exists yet, an empty-summary placeholder row holds the note;
 * generateClinicalSummary's upsert later fills the summary without touching it.
 */
export async function saveVisitNotes(
  patientId: string,
  from: string,
  to: string,
  notes: string
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { data: membership } = await supabase
    .from("patient_memberships")
    .select("role")
    .eq("patient_id", patientId)
    .single();
  if (!membership || membership.role === "viewer") return { ok: false };

  const trimmed = notes.trim();
  const { data: existing } = await supabase
    .from("report_summaries")
    .select("id")
    .eq("patient_id", patientId)
    .eq("from_date", from)
    .eq("to_date", to)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("report_summaries")
      .update({ visit_notes: trimmed || null })
      .eq("id", existing.id);
    return { ok: !error };
  }
  if (!trimmed) return { ok: true };
  const { error } = await supabase.from("report_summaries").insert({
    patient_id: patientId,
    from_date: from,
    to_date: to,
    facts_hash: "",
    summary: {},
    visit_notes: trimmed,
    generated_by_user_id: user.id,
  });
  return { ok: !error };
}

/**
 * Simple mode's one-button path: a fixed last-90-days snapshot with the
 * written summary prepared when missing. Summary generation is best-effort —
 * the report page renders the deterministic record either way — so a model
 * hiccup never blocks the print view.
 */
export async function openSimpleSnapshot() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active) redirect("/dashboard");

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

  // A visit-notes placeholder row has an empty summary — treat it as absent.
  const { data: existing } = await supabase
    .from("report_summaries")
    .select("summary")
    .eq("patient_id", active.id)
    .eq("from_date", from)
    .eq("to_date", to)
    .maybeSingle();
  const hasSummary =
    !!existing?.summary && Object.keys(existing.summary as object).length > 0;

  if (!hasSummary && active.role !== "viewer") {
    try {
      await generateClinicalSummary(active.id, from, to);
    } catch (err) {
      logError("report", "simple snapshot summary generation failed", err, {
        patientId: active.id,
      });
    }
  }

  redirect(`/report/${active.id}?from=${from}&to=${to}`);
}
