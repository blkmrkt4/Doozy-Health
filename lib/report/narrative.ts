import type {
  ReportFacts,
  MedicationFacts,
  DiaryMetricFacts,
} from "@/lib/report/report-data";
import { metricScopeLabel } from "@/lib/report/report-data";

// LLM narrator for the doctor report (PRD §5.10.1). Turns the deterministic
// facts into an observational clinical hand-off. The LLM only narrates; it
// invents no numbers and gives no advice. Three safety nets keep it on the
// wellness line (§6.1): a strict prompt, a defensive JSON parse, and a
// banned-language post-filter — any breach falls back to a deterministic
// summary built straight from the facts, so the report always renders and the
// pure pieces test without a live model (PRD §15).
//
// The pure helpers below carry no server-only imports; llmCall + extractJson
// are imported dynamically inside generateReportNarrative so this module can be
// unit-tested for the regulatory filter and fallback without the LLM env.

export type NarrativeMedication = { name: string; summary: string };

export type ClinicalNarrative = {
  overview: string;
  medications: NarrativeMedication[];
  adherence_notes: string;
  diary_observations: string;
  correlation_observations: string;
  /** describes ONLY curated interactions present in the facts (rule #9). */
  interaction_observations: string;
  data_caveats: string;
  /** false when the deterministic fallback produced this (no/failed LLM). */
  generatedByLlm: boolean;
};

// ── Banned-language filter (mirrors PRD §6.1) ────────────────────────────────
// A directive or clinical-advice phrasing in the model output means the whole
// summary is discarded in favour of the deterministic fallback. Kept narrow to
// avoid tripping on neutral factual prose ("logged blood pressure").
const BANNED_PATTERNS: RegExp[] = [
  /\b(diagnos|prescrib|titrat)\w*/i,
  /\bcured?\b/i,
  /\btreat(?:s|ed|ing|ment|ments)?\b/i,
  /\byou\s+should\b/i,
  /\bshould\s+(?:increase|decrease|raise|lower|reduce|stop|start|take|adjust|consider|switch|continue|discontinue)\b/i,
  /\brecommend\w*/i,
  /\badvis(?:e|es|ed|able|ory)\b/i,
  /\b(?:increase|decrease|raise|lower|reduce|stop|starting|start|adjust|change)\s+(?:the|your|their|his|her)\s+dose\b/i,
  /\bdose\s+now\b/i,
];

export function containsBannedLanguage(text: string): boolean {
  return BANNED_PATTERNS.some((re) => re.test(text));
}

/** All narrative prose joined, for a single banned-language scan. */
function narrativeText(n: ClinicalNarrative): string {
  return [
    n.overview,
    n.adherence_notes,
    n.diary_observations,
    n.correlation_observations,
    n.interaction_observations,
    n.data_caveats,
    ...n.medications.map((m) => m.summary),
  ].join("\n");
}

// ── Defensive validation of the model JSON ───────────────────────────────────

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Coerce raw parsed JSON into a ClinicalNarrative, tolerating missing fields.
 * Returns null only if the object is unusable (no overview and no medications).
 */
export function validateNarrative(obj: Record<string, unknown>): ClinicalNarrative | null {
  const overview = asString(obj.overview);
  const medsRaw = Array.isArray(obj.medications) ? obj.medications : [];
  const medications: NarrativeMedication[] = medsRaw
    .map((m) => {
      const o = (m ?? {}) as Record<string, unknown>;
      return { name: asString(o.name), summary: asString(o.summary) };
    })
    .filter((m) => m.name && m.summary);

  if (!overview && medications.length === 0) return null;

  return {
    overview,
    medications,
    adherence_notes: asString(obj.adherence_notes),
    diary_observations: asString(obj.diary_observations),
    correlation_observations: asString(obj.correlation_observations),
    interaction_observations: asString(obj.interaction_observations),
    data_caveats: asString(obj.data_caveats),
    generatedByLlm: true,
  };
}

// ── Deterministic fallback (and the per-section building blocks) ─────────────

export function periodLabel(facts: ReportFacts): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  return `${fmt(facts.period.from)} to ${fmt(facts.period.to)} (${facts.period.days} days)`;
}

function adherenceSentence(m: MedicationFacts): string {
  const a = m.adherence;
  if (a.consistency === "as needed") {
    return `${m.name} was logged as needed (${a.takenCount} dose${a.takenCount === 1 ? "" : "s"} recorded).`;
  }
  if (a.consistency === "insufficient data") {
    return `${a.takenCount} dose${a.takenCount === 1 ? "" : "s"} of ${m.name} were logged; there is not enough schedule information to assess consistency.`;
  }
  const parts: string[] = [
    `${a.coveredCount} of ${a.scheduledCount} scheduled doses of ${m.name} were logged over the period (${a.consistency})`,
  ];
  if (a.longestGapDays && a.longestGapDays >= 7) {
    parts.push(`with a longest gap of about ${a.longestGapDays} days`);
  } else if (a.gaps.length > 0) {
    parts.push(`with ${a.gaps.length} short gap${a.gaps.length === 1 ? "" : "s"}`);
  }
  if (a.skippedCount > 0) {
    parts.push(`and ${a.skippedCount} dose${a.skippedCount === 1 ? "" : "s"} explicitly marked as skipped`);
  }
  return parts.join(" ") + ".";
}

function overDoseSentence(m: MedicationFacts): string {
  const o = m.overDose;
  if (!o) return "";
  const upTo =
    o.maxRatio >= 1.1 ? ` (up to about ${o.maxRatio}× the prescribed amount)` : "";
  return ` On ${o.count} occasion${o.count === 1 ? "" : "s"}, a dose above the prescribed amount was logged${upTo}.`;
}

function medSummary(m: MedicationFacts): string {
  const regimen = m.chosenRegimen ?? m.prescribedRegimen ?? "no regimen recorded";
  let s = `${m.name}: ${regimen}.`;
  if (m.reasonNote) s += ` Note: ${m.reasonNote}.`;
  s += ` ${adherenceSentence(m)}`;
  s += overDoseSentence(m);
  return s;
}

function metricPhrase(d: DiaryMetricFacts): string {
  const scope = metricScopeLabel(d.scope);
  const where = scope === "general" ? "" : ` (${scope})`;
  const unit = d.unit ? ` ${d.unit}` : "";
  if (d.numeric) {
    const trend =
      d.numeric.last > d.numeric.first
        ? "trending up"
        : d.numeric.last < d.numeric.first
          ? "trending down"
          : "broadly flat";
    return `${d.name}${where}: ${d.entries} entries, mean ${d.numeric.mean}${unit} (range ${d.numeric.min}–${d.numeric.max}${unit}), ${trend} (${d.numeric.first} → ${d.numeric.last})`;
  }
  if (d.boolean) {
    return `${d.name}${where}: logged "yes" on ${d.boolean.yes} of ${d.boolean.total} entries`;
  }
  if (d.options && d.options.length > 0) {
    const top = d.options.slice(0, 3).map((o) => `${o.option} (${o.count})`).join(", ");
    return `${d.name}${where}: ${top}`;
  }
  return `${d.name}${where}: ${d.entries} entries`;
}

/**
 * Build a usable, regulator-safe summary purely from the facts — used when the
 * LLM is unavailable, returns garbage, or trips the banned-language filter.
 */
export function buildFallbackNarrative(facts: ReportFacts): ClinicalNarrative {
  const medCount = facts.medications.length;
  const who =
    facts.patient.ageYears != null
      ? `A ${facts.patient.ageYears}-year-old${facts.patient.sex ? ` ${facts.patient.sex}` : ""} patient`
      : "The patient";

  const adhoc =
    facts.adhocMeds.length > 0
      ? ` One-off medications were also logged: ${facts.adhocMeds
          .map((a) => `${a.name} (${a.doseCount}×)`)
          .join(", ")}.`
      : "";

  const overview =
    `${who} logged ${medCount} medication${medCount === 1 ? "" : "s"} over ${facts.period.days} days. ` +
    `This summary reflects only what was recorded in the wellness diary.${adhoc}`;

  const medications: NarrativeMedication[] = facts.medications.map((m) => ({
    name: m.name,
    summary: medSummary(m),
  }));

  // Adherence notes — surface multi-week gaps explicitly.
  const bigGaps = facts.medications
    .filter((m) => (m.adherence.longestGapDays ?? 0) >= 14)
    .map((m) => `${m.name} (≈ ${m.adherence.longestGapDays} days)`);
  const adherence_notes =
    bigGaps.length > 0
      ? `Extended gaps in logged dosing were recorded for ${bigGaps.join(" and ")}.`
      : facts.medications.some((m) => m.adherence.gaps.length > 0)
        ? "Occasional single missed doses were recorded; no extended gaps."
        : "";

  // Diary observations — grouped general / per-medication / labs.
  const general = facts.diaryMetrics.filter((d) => d.scope === "general" && d.cadence === "daily");
  const scoped = facts.diaryMetrics.filter((d) => d.scope !== "general" && d.cadence === "daily");
  const labs = facts.diaryMetrics.filter((d) => d.cadence === "periodic");
  const groups: string[] = [];
  if (general.length > 0)
    groups.push(`General measures — ${general.map(metricPhrase).join("; ")}.`);
  if (scoped.length > 0)
    groups.push(`Medication-specific measures — ${scoped.map(metricPhrase).join("; ")}.`);
  if (labs.length > 0)
    groups.push(`Labs and measurements — ${labs.map(metricPhrase).join("; ")}.`);
  const diary_observations = groups.join(" ");

  // Interactions — list ONLY the curated records present in the facts (rule #9).
  const interaction_observations =
    facts.interactions.length > 0
      ? `The following ${facts.interactions.length === 1 ? "interaction was" : "interactions were"} noted from curated references and may be worth discussing with a doctor or pharmacist: ` +
        facts.interactions
          .map((i) => `${i.aLabel} + ${i.bLabel} (${i.severity}) — ${i.mechanism}`)
          .join(" ")
      : "";

  const data_caveats =
    facts.period.days < 14
      ? "This is a short reporting period, so trends should be read with caution."
      : facts.diaryMetrics.length === 0
        ? "No diary measures were recorded in this period."
        : "";

  return {
    overview,
    medications,
    adherence_notes,
    diary_observations,
    correlation_observations: "",
    interaction_observations,
    data_caveats,
    generatedByLlm: false,
  };
}

// ── Public entry point ───────────────────────────────────────────────────────

export type NarrativeResult = {
  narrative: ClinicalNarrative;
  modelUsed: string | null;
};

/**
 * Generate the clinical narrative. Tries the LLM; on any failure (disabled
 * prompt, bad JSON, banned language) returns the deterministic fallback.
 */
export async function generateReportNarrative(
  facts: ReportFacts
): Promise<NarrativeResult> {
  const fallback = () => ({ narrative: buildFallbackNarrative(facts), modelUsed: null });

  let llmCall: typeof import("@/lib/llm").llmCall;
  let extractJson: typeof import("@/lib/extraction").extractJson;
  try {
    ({ llmCall } = await import("@/lib/llm"));
    ({ extractJson } = await import("@/lib/extraction"));
  } catch {
    return fallback();
  }

  let result;
  try {
    result = await llmCall("summarize_report_for_clinician", {
      period_label: periodLabel(facts),
      facts_json: JSON.stringify(facts),
    });
  } catch {
    return fallback();
  }

  if (!result.ok) return fallback();

  const parsed = extractJson(result.text);
  if (!parsed) return fallback();

  const validated = validateNarrative(parsed);
  if (!validated) return fallback();

  // Final regulatory gate: any directive/advice phrasing → discard the model
  // output entirely and use the deterministic summary instead.
  if (containsBannedLanguage(narrativeText(validated))) return fallback();

  return { narrative: validated, modelUsed: result.modelUsed };
}
