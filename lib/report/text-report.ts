import {
  metricScopeLabel,
  type ReportData,
  type DiaryMetricFacts,
  type AdherenceFacts,
} from "@/lib/report/report-data";
import type { ClinicalNarrative } from "@/lib/report/narrative";

// Plain-text rendering of the doctor report (PRD §5.10). A lightweight,
// copy-pasteable, screen-reader-friendly alternative to the styled HTML report —
// same content (written summary, per-medication dosing, tracked measures, opt-in
// full log), no charts. Pure string building, so it tests without a DB.

const DISCLAIMER =
  "WellKept is a wellness tool. It is not a medical device and does not provide " +
  "medical advice. Consult your doctor.";

const RULE = "=".repeat(64);

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function readableDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return iso;
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const month = d.toLocaleDateString("en-US", { month: "long" });
  return `${weekday}, ${month} ${ordinal(d.getDate())}, ${d.getFullYear()}`;
}

function adherenceText(a: AdherenceFacts): string {
  if (a.consistency === "as needed" || a.scheduledCount === 0) {
    return `Logged: ${a.takenCount} dose${a.takenCount === 1 ? "" : "s"}${
      a.consistency === "as needed" ? " (as needed)" : ""
    }`;
  }
  let s = `Logged: ${a.coveredCount} of ${a.scheduledCount} scheduled doses`;
  if (a.longestGapDays && a.longestGapDays >= 7) s += ` · longest gap ≈ ${a.longestGapDays} days`;
  if (a.skippedCount > 0) s += ` · ${a.skippedCount} marked skipped`;
  return s;
}

function metricLine(d: DiaryMetricFacts): string {
  const scope = metricScopeLabel(d.scope);
  const where = scope === "general" ? "" : ` (${scope})`;
  const unit = d.unit ? ` ${d.unit}` : "";
  if (d.numeric) {
    const trend =
      d.numeric.last > d.numeric.first
        ? "trending up"
        : d.numeric.last < d.numeric.first
          ? "trending down"
          : "steady";
    return `${d.name}${where}: ${d.entries} entries, mean ${d.numeric.mean}${unit} (range ${d.numeric.min}–${d.numeric.max}${unit}), ${trend} (${d.numeric.first} → ${d.numeric.last})`;
  }
  if (d.boolean) {
    return `${d.name}${where}: "yes" on ${d.boolean.yes} of ${d.boolean.total} entries`;
  }
  if (d.options && d.options.length > 0) {
    return `${d.name}${where}: ${d.options.slice(0, 3).map((o) => `${o.option} (${o.count})`).join(", ")}`;
  }
  return `${d.name}${where}: ${d.entries} entries`;
}

export function renderReportText(opts: {
  patientName: string;
  generatedDate: string; // YYYY-MM-DD
  data: ReportData;
  narrative: ClinicalNarrative | null;
  showFullLog: boolean;
}): string {
  const { patientName, generatedDate, data, narrative, showFullLog } = opts;
  const { facts, rows } = data;
  const out: string[] = [];

  // ── Header ─────────────────────────────────────────────────────────────────
  out.push("WELLKEPT — MEDICATION REPORT");
  out.push(patientName);
  out.push(`${readableDate(facts.period.from)} to ${readableDate(facts.period.to)}`);
  out.push(`Generated ${readableDate(generatedDate)}`);
  out.push("");
  out.push(DISCLAIMER);
  out.push("");

  // ── Summary ────────────────────────────────────────────────────────────────
  out.push(RULE, "SUMMARY", RULE);
  if (narrative) {
    if (narrative.overview) out.push(narrative.overview, "");
    if (narrative.adherence_notes) out.push(`Dosing — ${narrative.adherence_notes}`, "");
    if (narrative.diary_observations)
      out.push(`Tracked measures — ${narrative.diary_observations}`, "");
    if (narrative.correlation_observations)
      out.push(`Patterns to discuss — ${narrative.correlation_observations}`, "");
    if (narrative.data_caveats) out.push(narrative.data_caveats, "");
    out.push("Illustrative summary of what was logged — not medical advice.");
  } else {
    out.push(
      "No written summary has been generated for this period. This report is a",
      "plain record of what was logged, without analysis."
    );
  }
  out.push("");

  // ── Medications ────────────────────────────────────────────────────────────
  out.push(RULE, "MEDICATIONS", RULE);
  if (facts.medications.length === 0) {
    out.push("No medications in this period.");
  } else {
    for (const m of facts.medications) {
      out.push(m.name);
      if (m.prescribedRegimen) out.push(`  Prescribed: ${m.prescribedRegimen}`);
      if (m.chosenRegimen) out.push(`  Taking: ${m.chosenRegimen}`);
      if (m.reasonNote) out.push(`  Note: ${m.reasonNote}`);
      out.push(`  ${adherenceText(m.adherence)}`);
      const summary = narrative?.medications.find((x) => x.name === m.name)?.summary;
      if (summary) out.push(`  ${summary}`);
      out.push("");
    }
  }

  // ── Tracked measures ───────────────────────────────────────────────────────
  if (facts.diaryMetrics.length > 0) {
    out.push(RULE, "TRACKED MEASURES", RULE);
    const general = facts.diaryMetrics.filter((d) => d.scope === "general" && d.cadence === "daily");
    const scoped = facts.diaryMetrics.filter((d) => d.scope !== "general" && d.cadence === "daily");
    const labs = facts.diaryMetrics.filter((d) => d.cadence === "periodic");
    const group = (title: string, items: DiaryMetricFacts[]) => {
      if (items.length === 0) return;
      out.push(title);
      for (const d of items) out.push(`  ${metricLine(d)}`);
      out.push("");
    };
    group("General", general);
    group("By medication", scoped);
    group("Labs & measurements", labs);
  }

  // ── Appendix: complete dose log (opt-in) ───────────────────────────────────
  if (showFullLog && rows.doseLogs.length > 0) {
    out.push(RULE, "APPENDIX — COMPLETE DOSE LOG", RULE);
    const medName = new Map(rows.medications.map((m) => [m.id, m.display_name]));
    for (const l of rows.doseLogs) {
      const dt = new Date(l.logged_at);
      const date = dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
      const time = dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      const dose = l.amount && l.unit ? `${l.amount} ${l.unit}` : "—";
      out.push(
        `${date}  ${time}  ${medName.get(l.medication_id) ?? "—"}  ${dose}  ${l.event_type}` +
          (l.note ? `  — ${l.note}` : "")
      );
    }
    out.push("");
  }

  out.push(DISCLAIMER);
  out.push("");

  return out.join("\n");
}
