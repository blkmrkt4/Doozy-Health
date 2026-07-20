import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildReportData } from "@/lib/report/report-data";
import { renderReportText } from "@/lib/report/text-report";
import { buildFallbackNarrative, validateNarrative } from "@/lib/report/narrative";

// Plain-text view of the doctor report (PRD §5.10). Returns text/plain so the
// browser renders it as a readable, copy-pasteable document. Reads the cached
// written summary (never triggers an LLM call here). Membership-scoped.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ patientId: string }> }
) {
  const { patientId } = await params;
  const { searchParams } = req.nextUrl;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: membership } = await supabase
    .from("patient_memberships")
    .select("role")
    .eq("patient_id", patientId)
    .single();
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: patient } = await supabase
    .from("patients")
    .select("name")
    .eq("id", patientId)
    .single();
  if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const to = searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
  const from =
    searchParams.get("from") ??
    new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const showFullLog = searchParams.get("log") === "full";

  const [data, { data: cached }] = await Promise.all([
    buildReportData(supabase, patientId, from, to),
    supabase
      .from("report_summaries")
      .select("summary, visit_notes")
      .eq("patient_id", patientId)
      .eq("from_date", from)
      .eq("to_date", to)
      .maybeSingle(),
  ]);

  // Cached LLM narrative when valid (a visit-notes placeholder row has an
  // empty summary), else the deterministic fallback — never an LLM call here.
  const narrative =
    validateNarrative((cached?.summary as Record<string, unknown>) ?? {}) ??
    buildFallbackNarrative(data.facts);

  const text = renderReportText({
    patientName: patient.name as string,
    generatedDate: new Date().toISOString().slice(0, 10),
    data,
    narrative,
    showFullLog,
    visitNotes: (cached?.visit_notes as string | null) ?? null,
  });

  return new NextResponse(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
