import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDose, formatFrequency, formatRoute } from "@/lib/format";
import "./report.css";

// Doctor PDF report page (PRD §5.10, §13.16). Server-rendered HTML that
// Puppeteer converts to PDF. Also useful as a print-friendly view.
// Disclaimer footer on every logical section (PRD §6.1).

const DISCLAIMER =
  "WellKept is a wellness tool. It is not a medical device and does not provide medical advice. Consult your doctor.";

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<{ from?: string; to?: string; meds?: string }>;
}) {
  const { patientId } = await params;
  const { from, to, meds: medsParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Validate membership.
  const { data: membership } = await supabase
    .from("patient_memberships")
    .select("role")
    .eq("patient_id", patientId)
    .single();
  if (!membership) notFound();

  // Load patient.
  const { data: patient } = await supabase
    .from("patients")
    .select("name")
    .eq("id", patientId)
    .single();
  if (!patient) notFound();

  // Date range defaults: last 30 days.
  const endDate = to ?? new Date().toISOString().slice(0, 10);
  const startDate =
    from ??
    new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  // Optional medication filter.
  const medFilter = medsParam
    ? medsParam.split(",").filter(Boolean)
    : null;

  // Load medications.
  let medsQuery = supabase
    .from("medications")
    .select(
      "id, display_name, entry_source, prescribed_regimens(dose_amount, dose_unit, route, frequency, prescriber_name), " +
        "delivery_forms(form_type, concentration, manufacturer, expiry_date, batch), " +
        "chosen_regimens(dose_amount, dose_unit, route, frequency, active, reason_note)"
    )
    .eq("patient_id", patientId)
    .eq("archived", false)
    .order("created_at");

  if (medFilter) {
    medsQuery = medsQuery.in("id", medFilter);
  }

  const { data: medications } = await medsQuery;
  const meds = (medications ?? []) as unknown as Array<{
    id: string;
    display_name: string;
    entry_source: string;
    prescribed_regimens: Array<{
      dose_amount: string;
      dose_unit: string;
      route: string;
      frequency: unknown;
      prescriber_name: string | null;
    }> | null;
    delivery_forms: Array<{
      form_type: string;
      concentration: unknown;
      manufacturer: string | null;
      expiry_date: string | null;
      batch: string | null;
    }> | null;
    chosen_regimens: Array<{
      dose_amount: string;
      dose_unit: string;
      route: string;
      frequency: unknown;
      active: boolean;
      reason_note: string | null;
    }> | null;
  }>;

  // Load dose logs in range.
  const { data: doseLogs } = await supabase
    .from("dose_logs")
    .select(
      "medication_id, event_type, logged_at, amount, unit, route_taken, site, note"
    )
    .eq("patient_id", patientId)
    .gte("logged_at", `${startDate}T00:00:00`)
    .lte("logged_at", `${endDate}T23:59:59`)
    .order("logged_at");

  const logs = (doseLogs ?? []) as Array<{
    medication_id: string;
    event_type: string;
    logged_at: string;
    amount: string | null;
    unit: string | null;
    route_taken: string | null;
    site: string | null;
    note: string | null;
  }>;

  // Load diary entries in range.
  const { data: diaryData } = await supabase
    .from("diary_entries")
    .select("entry_at, field_values, note")
    .eq("patient_id", patientId)
    .gte("entry_at", `${startDate}T00:00:00`)
    .lte("entry_at", `${endDate}T23:59:59`)
    .order("entry_at");

  const diaryEntries = (diaryData ?? []) as Array<{
    entry_at: string;
    field_values: Record<string, unknown>;
    note: string | null;
  }>;

  // Load tracked field names for display.
  const { data: fieldsData } = await supabase
    .from("tracked_fields")
    .select("id, name")
    .eq("patient_id", patientId);
  const fieldNames = new Map(
    (fieldsData ?? []).map((f) => [f.id as string, f.name as string])
  );

  const medNameMap = new Map(meds.map((m) => [m.id, m.display_name]));
  const generatedDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="report">
      {/* Screen-only nav back to the export config; hidden in the PDF. */}
      <nav className="report-nav">
        <a href="/report" className="report-nav-link">
          ← Back to WellKept
        </a>
      </nav>

      {/* ── Cover ──────────────────────────────────────────────── */}
      <section className="report-cover">
        <h1 className="report-title">WellKept</h1>
        <h2 className="report-subtitle">{patient.name}</h2>
        <p className="report-dates">
          {startDate} to {endDate}
        </p>
        <p className="report-generated">Generated {generatedDate}</p>
        <p className="report-disclaimer">{DISCLAIMER}</p>
      </section>

      {/* ── Medications ────────────────────────────────────────── */}
      <section className="report-section">
        <h2 className="report-heading">Medications</h2>
        {meds.length === 0 ? (
          <p className="report-empty">No medications in this period.</p>
        ) : (
          meds.map((m) => {
            const prescribed = (m.prescribed_regimens ?? [])[0];
            const delivery = (m.delivery_forms ?? [])[0];
            const chosen = (m.chosen_regimens ?? []).find((c) => c.active);

            return (
              <div key={m.id} className="report-med">
                <h3 className="report-med-name">{m.display_name}</h3>
                <table className="report-table">
                  <tbody>
                    {prescribed ? (
                      <tr>
                        <td className="report-label">Prescribed</td>
                        <td>
                          {formatDose(
                            prescribed.dose_amount,
                            prescribed.dose_unit
                          )}{" "}
                          {formatRoute(prescribed.route)}{" "}
                          {formatFrequency(prescribed.frequency)}
                          {prescribed.prescriber_name
                            ? ` (${prescribed.prescriber_name})`
                            : ""}
                        </td>
                      </tr>
                    ) : null}
                    {delivery ? (
                      <tr>
                        <td className="report-label">Form</td>
                        <td>
                          {delivery.form_type}
                          {delivery.manufacturer
                            ? ` — ${delivery.manufacturer}`
                            : ""}
                          {delivery.batch ? ` (lot ${delivery.batch})` : ""}
                          {delivery.expiry_date
                            ? ` exp ${delivery.expiry_date}`
                            : ""}
                        </td>
                      </tr>
                    ) : null}
                    {chosen ? (
                      <tr>
                        <td className="report-label">Taking</td>
                        <td>
                          {formatDose(chosen.dose_amount, chosen.dose_unit)}{" "}
                          {formatRoute(chosen.route)}{" "}
                          {formatFrequency(chosen.frequency)}
                          {chosen.reason_note
                            ? ` — ${chosen.reason_note}`
                            : ""}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            );
          })
        )}
        <p className="report-disclaimer">{DISCLAIMER}</p>
      </section>

      {/* ── Dose history ───────────────────────────────────────── */}
      <section className="report-section">
        <h2 className="report-heading">Dose history</h2>
        {logs.length === 0 ? (
          <p className="report-empty">No doses logged in this period.</p>
        ) : (
          <table className="report-table report-log-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Medication</th>
                <th>Dose</th>
                <th>Type</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => {
                const dt = new Date(l.logged_at);
                return (
                  <tr key={i}>
                    <td>
                      {dt.toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </td>
                    <td>
                      {dt.toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td>{medNameMap.get(l.medication_id) ?? "—"}</td>
                    <td>
                      {l.amount && l.unit
                        ? formatDose(l.amount, l.unit)
                        : "—"}
                    </td>
                    <td>{l.event_type}</td>
                    <td>{l.note ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="report-disclaimer">{DISCLAIMER}</p>
      </section>

      {/* ── Diary entries ──────────────────────────────────────── */}
      {diaryEntries.length > 0 ? (
        <section className="report-section">
          <h2 className="report-heading">Diary</h2>
          <table className="report-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Fields</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {diaryEntries.map((e, i) => (
                <tr key={i}>
                  <td>
                    {new Date(e.entry_at).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td>
                    {Object.entries(e.field_values)
                      .map(
                        ([fid, val]) =>
                          `${fieldNames.get(fid) ?? fid}: ${val}`
                      )
                      .join(", ")}
                  </td>
                  <td>{e.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="report-disclaimer">{DISCLAIMER}</p>
        </section>
      ) : null}
    </div>
  );
}
