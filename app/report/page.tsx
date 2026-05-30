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

  return (
    <ReportForm patientId={active.id} patientName={active.name} />
  );
}
