import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { getDisplayPrefs } from "@/lib/display-prefs";
import { ReportForm } from "./report-form";
import { SimpleReport } from "./simple-report";

// Report export config page (PRD §5.10). Server component loads patient ID,
// client form handles date range + PDF download.

export default async function ReportConfigPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active) redirect("/dashboard");

  // Simple mode: one button, fixed 90-day range (users.display_prefs).
  const { simpleMode } = await getDisplayPrefs(supabase, user.id);
  if (simpleMode) {
    return <SimpleReport patientName={active.name} />;
  }

  // Default range = last 30 days; check whether a summary is already cached for
  // it so the view buttons don't prompt unnecessarily on first load. A row may
  // hold only visit notes (empty summary placeholder) — that doesn't count.
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const { data: existing } = await supabase
    .from("report_summaries")
    .select("summary, visit_notes")
    .eq("patient_id", active.id)
    .eq("from_date", from)
    .eq("to_date", to)
    .maybeSingle();
  const hasSummary =
    !!existing?.summary && Object.keys(existing.summary as object).length > 0;

  return (
    <ReportForm
      patientId={active.id}
      patientName={active.name}
      initialFrom={from}
      initialTo={to}
      initialHasSummary={hasSummary}
      initialVisitNotes={(existing?.visit_notes as string | null) ?? ""}
    />
  );
}
