import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { ReportForm } from "./report-form";

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

  // Default range = last 30 days; check whether a summary is already cached for
  // it so the view buttons don't prompt unnecessarily on first load.
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const { data: existing } = await supabase
    .from("report_summaries")
    .select("id")
    .eq("patient_id", active.id)
    .eq("from_date", from)
    .eq("to_date", to)
    .maybeSingle();

  return (
    <ReportForm
      patientId={active.id}
      patientName={active.name}
      initialFrom={from}
      initialTo={to}
      initialHasSummary={Boolean(existing)}
    />
  );
}
