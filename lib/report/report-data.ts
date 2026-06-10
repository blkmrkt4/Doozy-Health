import {
  occurrencesInWindow,
  frequencyIntervalMs,
  dayKey,
} from "@/lib/schedule";
import { formatRegimenSummary, formatRoute } from "@/lib/format";
import { isFrequency, type Frequency, type FieldType } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

// Deterministic facts layer for the doctor report (PRD §5.10.1). Everything a
// practitioner needs to understand the period is computed here in plain TS —
// adherence counts, dosing gaps/anomalies, diary-metric trends, and a shared
// weekly timeline aligning doses with tracked measures. NO LLM and NO numbers
// invented (hard rule #8): the narrator (lib/report/narrative.ts) only turns
// these facts into prose. `computeReportFacts` is pure so it tests without a DB
// (PRD §15); `buildReportData` is the thin Supabase loader around it.

const MS_DAY = 86_400_000;

// ── Raw rows (one shape per table the report reads) ──────────────────────────

export type PatientRow = {
  name: string;
  date_of_birth: string | null;
  sex: string | null;
};

export type MedicationRow = {
  id: string;
  display_name: string;
  canonical_drug_id: string | null;
  colour: string | null;
  prescribed_regimens:
    | {
        dose_amount: string;
        dose_unit: string;
        route: string;
        frequency: unknown;
        prescriber_name: string | null;
      }[]
    | null;
  delivery_forms:
    | {
        form_type: string;
        concentration: unknown;
        manufacturer: string | null;
        expiry_date: string | null;
        batch: string | null;
      }[]
    | null;
  chosen_regimens:
    | {
        dose_amount: string;
        dose_unit: string;
        route: string;
        frequency: unknown;
        active: boolean;
        reason_note: string | null;
        created_at: string;
      }[]
    | null;
};

export type DoseLogRow = {
  medication_id: string;
  event_type: string;
  logged_at: string;
  amount: string | null;
  unit: string | null;
  route_taken: string | null;
  site: string | null;
  note: string | null;
};

export type DiaryEntryRow = {
  entry_at: string;
  field_values: Record<string, unknown>;
  note: string | null;
};

export type TrackedFieldRow = {
  id: string;
  name: string;
  field_type: string;
  unit: string | null;
  category_options: string[] | null;
  cadence: string | null;
};

export type ReportRows = {
  patient: PatientRow;
  medications: MedicationRow[];
  doseLogs: DoseLogRow[];
  diaryEntries: DiaryEntryRow[];
  trackedFields: TrackedFieldRow[];
  /** tracked_field_id → medication_ids it is scoped to (empty ⇒ general). */
  fieldScope: Map<string, string[]>;
};

// ── Facts (the compact, number-bearing object handed to the LLM) ─────────────

export type DoseGap = {
  /** Local date of the first missed scheduled dose in the run. */
  startDate: string;
  /** Local date of the last missed scheduled dose in the run. */
  endDate: string;
  /** Consecutive scheduled doses with no logged dose nearby. */
  missedDoses: number;
  /** Approximate span of the gap in days. */
  days: number;
};

export type AdherenceFacts = {
  scheduledCount: number;
  takenCount: number;
  skippedCount: number;
  coveredCount: number;
  /** Longest run of consecutive missed scheduled doses, in days. */
  longestGapDays: number | null;
  /** Notable gaps (≥ 2 consecutive missed scheduled doses). */
  gaps: DoseGap[];
  consistency:
    | "regular"
    | "mostly regular"
    | "irregular"
    | "as needed"
    | "insufficient data";
};

export type MedicationFacts = {
  name: string;
  route: string;
  chosenRegimen: string | null;
  prescribedRegimen: string | null;
  reasonNote: string | null;
  adherence: AdherenceFacts;
};

export type MetricScope = "general" | { medications: string[] };

export type DiaryMetricFacts = {
  name: string;
  scope: MetricScope;
  cadence: "daily" | "periodic";
  fieldType: FieldType;
  unit: string | null;
  entries: number;
  /** number / scale_1_10 */
  numeric?: {
    min: number;
    max: number;
    mean: number;
    first: number;
    last: number;
  };
  /** boolean */
  boolean?: { yes: number; total: number };
  /** category / multiselect */
  options?: { option: string; count: number }[];
};

export type TimelineWeek = {
  weekStart: string;
  /** medication name → logged (taken) dose count that week. */
  doses: Record<string, number>;
  /** numeric/scale metric name → weekly mean. */
  metrics: Record<string, number>;
};

export type ReportFacts = {
  period: { from: string; to: string; days: number };
  patient: { ageYears?: number; sex?: string };
  medications: MedicationFacts[];
  diaryMetrics: DiaryMetricFacts[];
  timeline: TimelineWeek[];
};

// ── Chart series (full resolution, for the deterministic SVG charts) ─────────

export type DiarySeries =
  | {
      kind: "numeric";
      name: string;
      scope: MetricScope;
      cadence: "daily" | "periodic";
      unit: string | null;
      points: { date: string; value: number }[];
    }
  | {
      kind: "boolean";
      name: string;
      scope: MetricScope;
      cadence: "daily" | "periodic";
      points: { date: string; value: boolean }[];
    }
  | {
      kind: "distribution";
      name: string;
      scope: MetricScope;
      cadence: "daily" | "periodic";
      counts: { option: string; count: number }[];
      total: number;
    };

export type ReportData = {
  rows: ReportRows;
  facts: ReportFacts;
  diarySeries: DiarySeries[];
  /** medication id → adherence, for the deterministic per-med stat line. */
  medAdherence: Map<string, AdherenceFacts>;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function activeChosen(m: MedicationRow) {
  return (m.chosen_regimens ?? []).find((c) => c.active) ?? null;
}

function ageFromDob(dob: string | null, refIso: string): number | undefined {
  if (!dob) return undefined;
  const b = new Date(dob);
  const ref = new Date(refIso);
  if (!Number.isFinite(b.getTime()) || !Number.isFinite(ref.getTime())) return undefined;
  let age = ref.getFullYear() - b.getFullYear();
  const m = ref.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < b.getDate())) age--;
  return age >= 0 && age < 130 ? age : undefined;
}

function mean(ns: number[]): number {
  if (ns.length === 0) return 0;
  return Math.round((ns.reduce((a, b) => a + b, 0) / ns.length) * 10) / 10;
}

function scopeLabel(scope: MetricScope): string {
  return scope === "general" ? "general" : scope.medications.join(", ");
}

/**
 * Adherence facts for one medication: scheduled doses (from the chosen regimen)
 * vs logged doses, and the runs of consecutive misses that surface "missed for
 * three weeks" rather than "missed the odd dose". Deterministic; greedily
 * matches each scheduled occurrence to the nearest unused taken log within half
 * a dosing interval.
 */
export function computeAdherence(
  freq: Frequency,
  anchorMs: number,
  fromMs: number,
  toMs: number,
  takenMs: number[],
  skippedCount: number
): AdherenceFacts {
  const takenCount = takenMs.length;

  if (freq.type === "as_needed") {
    return {
      scheduledCount: 0,
      takenCount,
      skippedCount,
      coveredCount: 0,
      longestGapDays: null,
      gaps: [],
      consistency: "as needed",
    };
  }

  const scheduled = occurrencesInWindow(freq, anchorMs, fromMs, toMs);
  const intervalMs = frequencyIntervalMs(freq) ?? MS_DAY;
  const tol = intervalMs / 2;

  if (scheduled.length === 0) {
    return {
      scheduledCount: 0,
      takenCount,
      skippedCount,
      coveredCount: 0,
      longestGapDays: null,
      gaps: [],
      consistency: "insufficient data",
    };
  }

  // Greedy nearest-match: each taken log can cover at most one occurrence.
  const sortedTaken = [...takenMs].sort((a, b) => a - b);
  const used = new Array(sortedTaken.length).fill(false);
  const covered: boolean[] = scheduled.map((occ) => {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < sortedTaken.length; i++) {
      if (used[i]) continue;
      const d = Math.abs(sortedTaken[i] - occ);
      if (d <= tol && d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      used[bestIdx] = true;
      return true;
    }
    return false;
  });

  const coveredCount = covered.filter(Boolean).length;
  const intervalDays = intervalMs / MS_DAY;

  // Runs of consecutive misses → gaps.
  const gaps: DoseGap[] = [];
  let longestGapDays = 0;
  let runStart = -1;
  const flush = (endExclusive: number) => {
    if (runStart < 0) return;
    const runLen = endExclusive - runStart;
    const startDate = dayKey(scheduled[runStart]);
    const endDate = dayKey(scheduled[endExclusive - 1]);
    const days = Math.max(1, Math.round(runLen * intervalDays));
    longestGapDays = Math.max(longestGapDays, days);
    if (runLen >= 2) gaps.push({ startDate, endDate, missedDoses: runLen, days });
    runStart = -1;
  };
  for (let i = 0; i < covered.length; i++) {
    if (!covered[i]) {
      if (runStart < 0) runStart = i;
    } else {
      flush(i);
    }
  }
  flush(covered.length);

  const ratio = coveredCount / scheduled.length;
  let consistency: AdherenceFacts["consistency"];
  if (ratio >= 0.95) consistency = "regular";
  else if (ratio >= 0.75) consistency = "mostly regular";
  else consistency = "irregular";

  return {
    scheduledCount: scheduled.length,
    takenCount,
    skippedCount,
    coveredCount,
    longestGapDays: longestGapDays || null,
    gaps,
    consistency,
  };
}

// ── Pure compute ─────────────────────────────────────────────────────────────

/**
 * Turn raw rows into the report facts + chart series. Pure: every time-dependent
 * value comes from the explicit `from`/`to` range, so it is fully testable.
 */
export function computeReportFacts(
  rows: ReportRows,
  from: string,
  to: string
): ReportData {
  const fromMs = new Date(`${from}T00:00:00`).getTime();
  const toMs = new Date(`${to}T23:59:59`).getTime();
  const days = Math.max(1, Math.round((toMs - fromMs) / MS_DAY));

  const medName = new Map(rows.medications.map((m) => [m.id, m.display_name]));

  // Logs in range, bucketed by medication and event class.
  const takenByMed = new Map<string, number[]>();
  const skippedByMed = new Map<string, number>();
  for (const l of rows.doseLogs) {
    const ts = new Date(l.logged_at).getTime();
    if (ts < fromMs || ts > toMs) continue;
    if (l.event_type === "taken" || l.event_type === "prn") {
      const arr = takenByMed.get(l.medication_id) ?? [];
      arr.push(ts);
      takenByMed.set(l.medication_id, arr);
    } else if (l.event_type === "skipped") {
      skippedByMed.set(l.medication_id, (skippedByMed.get(l.medication_id) ?? 0) + 1);
    }
  }

  // ── Per-medication facts ───────────────────────────────────────────────────
  const medAdherence = new Map<string, AdherenceFacts>();
  const medications: MedicationFacts[] = rows.medications.map((m) => {
    const chosen = activeChosen(m);
    const prescribed = (m.prescribed_regimens ?? [])[0] ?? null;
    const taken = takenByMed.get(m.id) ?? [];
    const skipped = skippedByMed.get(m.id) ?? 0;

    let adherence: AdherenceFacts;
    if (chosen && isFrequency(chosen.frequency)) {
      const anchorMs = new Date(chosen.created_at).getTime();
      adherence = computeAdherence(
        chosen.frequency,
        Number.isFinite(anchorMs) ? anchorMs : fromMs,
        fromMs,
        toMs,
        taken,
        skipped
      );
    } else {
      adherence = {
        scheduledCount: 0,
        takenCount: taken.length,
        skippedCount: skipped,
        coveredCount: 0,
        longestGapDays: null,
        gaps: [],
        consistency: "insufficient data",
      };
    }
    medAdherence.set(m.id, adherence);

    return {
      name: m.display_name,
      route: chosen ? formatRoute(chosen.route) : prescribed ? formatRoute(prescribed.route) : "—",
      chosenRegimen: chosen
        ? formatRegimenSummary({
            dose_amount: chosen.dose_amount,
            dose_unit: chosen.dose_unit,
            frequency: chosen.frequency,
            route: chosen.route,
          })
        : null,
      prescribedRegimen: prescribed
        ? formatRegimenSummary({
            dose_amount: prescribed.dose_amount,
            dose_unit: prescribed.dose_unit,
            frequency: prescribed.frequency,
            route: prescribed.route,
          })
        : null,
      reasonNote: chosen?.reason_note ?? null,
      adherence,
    };
  });

  // ── Diary metrics + chart series ───────────────────────────────────────────
  const entriesInRange = rows.diaryEntries.filter((e) => {
    const ts = new Date(e.entry_at).getTime();
    return ts >= fromMs && ts <= toMs;
  });

  const diaryMetrics: DiaryMetricFacts[] = [];
  const diarySeries: DiarySeries[] = [];

  for (const f of rows.trackedFields) {
    const scopeIds = rows.fieldScope.get(f.id) ?? [];
    const scope: MetricScope =
      scopeIds.length === 0
        ? "general"
        : { medications: scopeIds.map((id) => medName.get(id) ?? "a medication") };
    const cadence: "daily" | "periodic" = f.cadence === "periodic" ? "periodic" : "daily";
    const fieldType = f.field_type as FieldType;

    // Collect this field's values across in-range entries, in date order.
    const samples: { date: string; raw: unknown }[] = [];
    for (const e of entriesInRange) {
      if (!(f.id in e.field_values)) continue;
      const raw = e.field_values[f.id];
      if (raw == null || raw === "") continue;
      samples.push({ date: dayKey(new Date(e.entry_at).getTime()), raw });
    }
    if (samples.length === 0) continue;

    const base = { name: f.name, scope, cadence };

    if (fieldType === "number" || fieldType === "scale_1_10") {
      const points = samples
        .map((s) => ({ date: s.date, value: Number(s.raw) }))
        .filter((p) => Number.isFinite(p.value));
      if (points.length === 0) continue;
      const vals = points.map((p) => p.value);
      diaryMetrics.push({
        ...base,
        fieldType,
        unit: f.unit,
        entries: points.length,
        numeric: {
          min: Math.min(...vals),
          max: Math.max(...vals),
          mean: mean(vals),
          first: vals[0],
          last: vals[vals.length - 1],
        },
      });
      diarySeries.push({ kind: "numeric", ...base, unit: f.unit, points });
    } else if (fieldType === "boolean") {
      const points = samples.map((s) => ({ date: s.date, value: Boolean(s.raw) }));
      const yes = points.filter((p) => p.value).length;
      diaryMetrics.push({
        ...base,
        fieldType,
        unit: f.unit,
        entries: points.length,
        boolean: { yes, total: points.length },
      });
      diarySeries.push({ kind: "boolean", ...base, points });
    } else if (fieldType === "category" || fieldType === "multiselect") {
      const tally = new Map<string, number>();
      for (const s of samples) {
        const opts = Array.isArray(s.raw) ? (s.raw as unknown[]) : [s.raw];
        for (const o of opts) {
          const key = String(o);
          tally.set(key, (tally.get(key) ?? 0) + 1);
        }
      }
      const counts = [...tally.entries()]
        .map(([option, count]) => ({ option, count }))
        .sort((a, b) => b.count - a.count);
      diaryMetrics.push({
        ...base,
        fieldType,
        unit: f.unit,
        entries: samples.length,
        options: counts.slice(0, 6),
      });
      diarySeries.push({ kind: "distribution", ...base, counts, total: samples.length });
    } else {
      // freetext: count only — never dump raw note text into the LLM facts.
      diaryMetrics.push({
        ...base,
        fieldType,
        unit: f.unit,
        entries: samples.length,
      });
    }
  }

  // ── Weekly timeline (dose counts + numeric-metric means) ───────────────────
  const numericFieldNames = new Set(
    diaryMetrics.filter((d) => d.numeric).map((d) => d.name)
  );
  const fieldByName = new Map(rows.trackedFields.map((f) => [f.name, f.id]));
  const timeline: TimelineWeek[] = [];
  const weekCount = Math.min(12, Math.ceil(days / 7));
  for (let w = 0; w < weekCount; w++) {
    const wStart = fromMs + w * 7 * MS_DAY;
    const wEnd = Math.min(toMs, wStart + 7 * MS_DAY);
    if (wStart > toMs) break;

    const doses: Record<string, number> = {};
    for (const m of rows.medications) {
      const taken = (takenByMed.get(m.id) ?? []).filter((ts) => ts >= wStart && ts < wEnd);
      if (taken.length > 0) doses[m.display_name] = taken.length;
    }

    const metrics: Record<string, number> = {};
    for (const name of numericFieldNames) {
      const fid = fieldByName.get(name);
      if (!fid) continue;
      const vals: number[] = [];
      for (const e of entriesInRange) {
        const ts = new Date(e.entry_at).getTime();
        if (ts < wStart || ts >= wEnd) continue;
        const raw = e.field_values[fid];
        if (raw == null || raw === "") continue;
        const n = Number(raw);
        if (Number.isFinite(n)) vals.push(n);
      }
      if (vals.length > 0) metrics[name] = mean(vals);
    }

    if (Object.keys(doses).length > 0 || Object.keys(metrics).length > 0) {
      timeline.push({ weekStart: dayKey(wStart), doses, metrics });
    }
  }

  const facts: ReportFacts = {
    period: { from, to, days },
    patient: {
      ageYears: ageFromDob(rows.patient.date_of_birth, to),
      sex: rows.patient.sex ?? undefined,
    },
    medications,
    diaryMetrics,
    timeline,
  };

  return { rows, facts, diarySeries, medAdherence };
}

// ── Supabase loader ──────────────────────────────────────────────────────────

/**
 * Load every row the report needs for one patient + date range. Membership RLS
 * does the scoping; callers must still have verified the membership exists.
 */
export async function loadReportRows(
  supabase: SupabaseClient,
  patientId: string,
  from: string,
  to: string
): Promise<ReportRows> {
  const [patientRes, medsRes, logsRes, diaryRes, fieldsRes, scopeRes] =
    await Promise.all([
      supabase.from("patients").select("name, date_of_birth, sex").eq("id", patientId).single(),
      supabase
        .from("medications")
        .select(
          "id, display_name, canonical_drug_id, colour, " +
            "prescribed_regimens(dose_amount, dose_unit, route, frequency, prescriber_name), " +
            "delivery_forms(form_type, concentration, manufacturer, expiry_date, batch), " +
            "chosen_regimens(dose_amount, dose_unit, route, frequency, active, reason_note, created_at)"
        )
        .eq("patient_id", patientId)
        .eq("archived", false)
        .order("created_at"),
      supabase
        .from("dose_logs")
        .select("medication_id, event_type, logged_at, amount, unit, route_taken, site, note")
        .eq("patient_id", patientId)
        .gte("logged_at", `${from}T00:00:00`)
        .lte("logged_at", `${to}T23:59:59`)
        .order("logged_at"),
      supabase
        .from("diary_entries")
        .select("entry_at, field_values, note")
        .eq("patient_id", patientId)
        .gte("entry_at", `${from}T00:00:00`)
        .lte("entry_at", `${to}T23:59:59`)
        .order("entry_at"),
      supabase
        .from("tracked_fields")
        .select("id, name, field_type, unit, category_options, cadence")
        .eq("patient_id", patientId)
        .eq("active", true)
        .order("display_order"),
      supabase
        .from("tracked_field_medications")
        .select("tracked_field_id, medication_id")
        .eq("patient_id", patientId),
    ]);

  const fieldScope = new Map<string, string[]>();
  for (const r of (scopeRes.data ?? []) as { tracked_field_id: string; medication_id: string }[]) {
    const arr = fieldScope.get(r.tracked_field_id) ?? [];
    arr.push(r.medication_id);
    fieldScope.set(r.tracked_field_id, arr);
  }

  return {
    patient: (patientRes.data as PatientRow) ?? { name: "", date_of_birth: null, sex: null },
    medications: (medsRes.data ?? []) as unknown as MedicationRow[],
    doseLogs: (logsRes.data ?? []) as DoseLogRow[],
    diaryEntries: (diaryRes.data ?? []) as unknown as DiaryEntryRow[],
    trackedFields: (fieldsRes.data ?? []) as TrackedFieldRow[],
    fieldScope,
  };
}

export async function buildReportData(
  supabase: SupabaseClient,
  patientId: string,
  from: string,
  to: string
): Promise<ReportData> {
  const rows = await loadReportRows(supabase, patientId, from, to);
  return computeReportFacts(rows, from, to);
}

/** Compact label for the scope of a metric, for prose/UI. */
export function metricScopeLabel(scope: MetricScope): string {
  return scopeLabel(scope);
}
