import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDose, formatFrequency, formatRoute } from "@/lib/format";
import {
  buildReportData,
  metricScopeLabel,
  type DiarySeries,
} from "@/lib/report/report-data";
import { buildReportPkCharts } from "@/lib/report/pk-chart-data";
import { type ClinicalNarrative } from "@/lib/report/narrative";
import { AmountInSystemChart } from "@/app/_components/amount-in-system-chart";
import { Sparkline, BooleanStrip, DistributionBars } from "@/app/diary/_components/field-charts";
import { ScaleChart, type ScaleSeries } from "@/app/diary/_components/scale-chart";
import "./report.css";

// Doctor "Snapshot" report (PRD §5.10, §5.10.1). Server-rendered HTML viewed in
// the browser (or as plain text). The body leads with a cached clinical
// narrative, then per-medication regimen + adherence + over-dose + PK chart, a
// replica of the diary's tracked-measures view (combined scale chart + compact
// mini-cards), curated interactions to discuss, and — only when asked (?log=full)
// — the full dose log as an appendix. Disclaimer footer on every section (§6.1).

const DISCLAIMER =
  "WellKept is a wellness tool. It is not a medical device and does not provide medical advice. Consult your doctor.";

function AdherenceLine({
  scheduled,
  covered,
  taken,
  longestGapDays,
  skipped,
  asNeeded,
}: {
  scheduled: number;
  covered: number;
  taken: number;
  longestGapDays: number | null;
  skipped: number;
  asNeeded: boolean;
}) {
  // A neutral record of what was logged — never a score or judgement (rule #14).
  const parts: string[] = [];
  if (asNeeded || scheduled === 0) {
    parts.push(`${taken} dose${taken === 1 ? "" : "s"} logged${asNeeded ? " (as needed)" : ""}`);
  } else {
    parts.push(`${covered} of ${scheduled} scheduled doses logged`);
    if (longestGapDays && longestGapDays >= 7) parts.push(`longest gap ≈ ${longestGapDays} days`);
  }
  if (skipped > 0) parts.push(`${skipped} marked skipped`);
  return <p className="report-adherence">{parts.join(" · ")}</p>;
}

function MeasureCard({ s }: { s: DiarySeries }) {
  const scopeLabel = s.scope !== "general" ? metricScopeLabel(s.scope) : null;
  return (
    <div className="report-metric">
      <p className="report-metric-name">
        {s.name}
        {scopeLabel ? (
          <span className="report-metric-scope"> · {scopeLabel}</span>
        ) : null}
      </p>
      {s.kind === "numeric" ? (
        <>
          <p className="report-metric-stats">
            avg {s.stats.avg.toFixed(1)} · med {s.stats.median.toFixed(1)} · range{" "}
            {s.stats.min}–{s.stats.max}
            {s.unit ? ` ${s.unit}` : ""}
          </p>
          <Sparkline
            points={s.points}
            yMin={s.scale ? 1 : undefined}
            yMax={s.scale ? 10 : undefined}
          />
        </>
      ) : s.kind === "boolean" ? (
        <BooleanStrip points={s.points} />
      ) : (
        <DistributionBars counts={s.counts} total={s.total} />
      )}
    </div>
  );
}

function MeasureGroup({ title, series }: { title: string; series: DiarySeries[] }) {
  if (series.length === 0) return null;
  return (
    <div className="report-metric-group">
      <h3 className="report-metric-heading">{title}</h3>
      <div className="report-metric-grid">
        {series.map((s, i) => (
          <MeasureCard key={i} s={s} />
        ))}
      </div>
    </div>
  );
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<{ from?: string; to?: string; meds?: string; log?: string }>;
}) {
  const { patientId } = await params;
  const { from, to, log } = await searchParams;

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

  // Date range defaults: last 30 days.
  const endDate = to ?? new Date().toISOString().slice(0, 10);
  const startDate =
    from ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const showFullLog = log === "full";

  // Build the deterministic report dataset + the cached narrative + PK charts.
  const data = await buildReportData(supabase, patientId, startDate, endDate);
  if (!data.rows.patient.name) notFound();

  const [{ data: cached }, pkCharts] = await Promise.all([
    supabase
      .from("report_summaries")
      .select("summary")
      .eq("patient_id", patientId)
      .eq("from_date", startDate)
      .eq("to_date", endDate)
      .maybeSingle(),
    buildReportPkCharts(supabase, data.rows.medications, data.rows.doseLogs, startDate, endDate),
  ]);

  const narrative = (cached?.summary as ClinicalNarrative | undefined) ?? null;
  const narrativeByMed = new Map(
    (narrative?.medications ?? []).map((m) => [m.name, m.summary])
  );

  const generatedDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  // Replicate the diary: all 1–10 scale fields share one combined chart; the rest
  // become compact mini-cards grouped general / per-medication / labs.
  const scaleSeries: ScaleSeries[] = data.diarySeries
    .filter(
      (s): s is Extract<DiarySeries, { kind: "numeric" }> =>
        s.kind === "numeric" && s.scale
    )
    .map((s) => ({
      id: s.name,
      name: s.name,
      points: s.points,
      avg: s.stats.avg,
      median: s.stats.median,
      min: s.stats.min,
      max: s.stats.max,
    }));
  const usePanel = scaleSeries.length >= 2;
  const panelNames = new Set(usePanel ? scaleSeries.map((s) => s.name) : []);
  const others = data.diarySeries.filter((s) => !panelNames.has(s.name));
  const general = others.filter((s) => s.scope === "general" && s.cadence === "daily");
  const scoped = others.filter((s) => s.scope !== "general" && s.cadence === "daily");
  const labs = others.filter((s) => s.cadence === "periodic");
  const hasMetrics = data.diarySeries.length > 0;

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
        <h2 className="report-subtitle">{data.rows.patient.name}</h2>
        <p className="report-dates">
          {startDate} to {endDate}
        </p>
        <p className="report-generated">Generated {generatedDate}</p>
        <p className="report-disclaimer">{DISCLAIMER}</p>
      </section>

      {/* ── Clinical summary ───────────────────────────────────── */}
      <section className="report-section">
        <h2 className="report-heading">Summary</h2>
        {narrative ? (
          <div className="report-summary">
            {narrative.overview ? <p>{narrative.overview}</p> : null}
            {narrative.adherence_notes ? (
              <p>
                <span className="report-summary-label">Dosing — </span>
                {narrative.adherence_notes}
              </p>
            ) : null}
            {narrative.diary_observations ? (
              <p>
                <span className="report-summary-label">Tracked measures — </span>
                {narrative.diary_observations}
              </p>
            ) : null}
            {narrative.correlation_observations ? (
              <p>
                <span className="report-summary-label">Patterns to discuss — </span>
                {narrative.correlation_observations}
              </p>
            ) : null}
            {narrative.data_caveats ? (
              <p className="report-summary-caveat">{narrative.data_caveats}</p>
            ) : null}
            <p className="report-summary-stamp">
              Illustrative summary of what was logged — not medical advice.
            </p>
          </div>
        ) : (
          <p className="report-empty">
            No written summary has been generated for this period yet. Generate
            one from the Snapshot screen, then reopen this report.
          </p>
        )}
        <p className="report-disclaimer">{DISCLAIMER}</p>
      </section>

      {/* ── Medications ────────────────────────────────────────── */}
      <section className="report-section">
        <h2 className="report-heading">Medications</h2>
        {data.rows.medications.length === 0 ? (
          <p className="report-empty">No medications in this period.</p>
        ) : (
          data.rows.medications.map((m) => {
            const prescribed = (m.prescribed_regimens ?? [])[0];
            const delivery = (m.delivery_forms ?? [])[0];
            const chosen = (m.chosen_regimens ?? []).find((c) => c.active);
            const adh = data.medAdherence.get(m.id);
            const od = data.medOverDose.get(m.id);
            const pk = pkCharts.get(m.id);
            const medNarrative = narrativeByMed.get(m.display_name);

            return (
              <div key={m.id} className="report-med">
                <h3 className="report-med-name">{m.display_name}</h3>
                <table className="report-table">
                  <tbody>
                    {prescribed ? (
                      <tr>
                        <td className="report-label">Prescribed</td>
                        <td>
                          {formatDose(prescribed.dose_amount, prescribed.dose_unit)}{" "}
                          {formatRoute(prescribed.route)}{" "}
                          {formatFrequency(prescribed.frequency)}
                          {prescribed.prescriber_name ? ` (${prescribed.prescriber_name})` : ""}
                        </td>
                      </tr>
                    ) : null}
                    {delivery ? (
                      <tr>
                        <td className="report-label">Form</td>
                        <td>
                          {delivery.form_type}
                          {delivery.manufacturer ? ` — ${delivery.manufacturer}` : ""}
                          {delivery.batch ? ` (lot ${delivery.batch})` : ""}
                          {delivery.expiry_date ? ` exp ${delivery.expiry_date}` : ""}
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
                          {chosen.reason_note ? ` — ${chosen.reason_note}` : ""}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>

                {adh ? (
                  <AdherenceLine
                    scheduled={adh.scheduledCount}
                    covered={adh.coveredCount}
                    taken={adh.takenCount}
                    longestGapDays={adh.longestGapDays}
                    skipped={adh.skippedCount}
                    asNeeded={adh.consistency === "as needed"}
                  />
                ) : null}

                {od ? (
                  <p className="report-overdose">
                    Logged above the prescribed dose on {od.count}{" "}
                    {od.count === 1 ? "day" : "days"}
                    {od.maxRatio >= 1.1 ? ` (up to ≈ ${od.maxRatio}× prescribed)` : ""}.
                  </p>
                ) : null}

                {medNarrative ? <p className="report-med-narrative">{medNarrative}</p> : null}

                {pk ? (
                  <div className="report-chart">
                    <AmountInSystemChart
                      drug={pk.drug}
                      doses={pk.doses}
                      prescribed={pk.prescribed}
                      identityColor={pk.identityColor ?? undefined}
                      nowDays={pk.nowDays}
                      nowDate={pk.nowDate}
                    />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
        <p className="report-disclaimer">{DISCLAIMER}</p>
      </section>

      {/* ── Interactions to discuss (curated; rule #9) ─────────── */}
      {data.facts.interactions.length > 0 ? (
        <section className="report-section">
          <h2 className="report-heading">Interactions to discuss</h2>
          <p className="report-interactions-intro">
            From curated references, for the medications and substances on record.
            Patterns to raise with a doctor or pharmacist — not a diagnosis or an
            instruction.
          </p>
          {narrative?.interaction_observations ? (
            <div className="report-summary">
              <p>{narrative.interaction_observations}</p>
            </div>
          ) : null}
          <ul className="report-interactions">
            {data.facts.interactions.map((it, i) => (
              <li key={i} className={`report-interaction sev-${it.severity}`}>
                <span className="report-interaction-head">
                  <span className="report-interaction-pair">
                    {it.aLabel} + {it.bLabel}
                  </span>
                  <span className="report-interaction-sev">{it.severity}</span>
                </span>
                <span className="report-interaction-mech">{it.mechanism}</span>
              </li>
            ))}
          </ul>
          <p className="report-disclaimer">{DISCLAIMER}</p>
        </section>
      ) : null}

      {/* ── Tracked measures (diary replica) ───────────────────── */}
      {hasMetrics ? (
        <section className="report-section">
          <h2 className="report-heading">Tracked measures</h2>
          {usePanel ? (
            <div className="report-scale-panel">
              <p className="report-metric-heading">Scale measures (1–10)</p>
              <ScaleChart fields={scaleSeries} />
            </div>
          ) : null}
          <MeasureGroup title="General" series={general} />
          <MeasureGroup title="By medication" series={scoped} />
          <MeasureGroup title="Labs & measurements" series={labs} />
          <p className="report-disclaimer">{DISCLAIMER}</p>
        </section>
      ) : null}

      {/* ── Appendix: complete dose log (opt-in) ───────────────── */}
      {showFullLog ? (
        <section className="report-section">
          <h2 className="report-heading">Appendix — complete dose log</h2>
          {data.rows.doseLogs.length === 0 ? (
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
                {data.rows.doseLogs.map((l, i) => {
                  const dt = new Date(l.logged_at);
                  const medName =
                    data.rows.medications.find((m) => m.id === l.medication_id)?.display_name ??
                    "—";
                  return (
                    <tr key={i}>
                      <td>{dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</td>
                      <td>{dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</td>
                      <td>{medName}</td>
                      <td>{l.amount && l.unit ? formatDose(l.amount, l.unit) : "—"}</td>
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
      ) : null}
    </div>
  );
}
