import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderPdf } from "@/lib/pdf";

// PDF generation endpoint (PRD §5.10, §13.16). Renders the report page via
// Puppeteer and returns the PDF as a downloadable file.

// Serverless Chromium needs the Node runtime (not edge) and time to cold-start,
// unpack the binary, and render. Memory is set in vercel.json.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const body = (await req.json()) as {
    patientId?: string;
    from?: string;
    to?: string;
    meds?: string;
    log?: string;
  };

  const { patientId, from, to, meds, log } = body;
  if (!patientId) {
    return NextResponse.json({ error: "Missing patientId" }, { status: 400 });
  }

  // Validate membership.
  const { data: membership } = await supabase
    .from("patient_memberships")
    .select("role")
    .eq("patient_id", patientId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Load patient name for the filename.
  const { data: patient } = await supabase
    .from("patients")
    .select("name")
    .eq("id", patientId)
    .single();

  const patientName = (patient?.name as string) ?? "Patient";
  const startDate = from ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const endDate = to ?? new Date().toISOString().slice(0, 10);

  // Build the report URL.
  const baseUrl = req.nextUrl.origin;
  const params = new URLSearchParams({ from: startDate, to: endDate });
  if (meds) params.set("meds", meds);
  if (log === "full") params.set("log", "full");
  const reportUrl = `${baseUrl}/report/${patientId}?${params}`;

  try {
    const pdf = await renderPdf(reportUrl);

    const filename = `WellKept — ${patientName} — ${startDate} to ${endDate}.pdf`;

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
