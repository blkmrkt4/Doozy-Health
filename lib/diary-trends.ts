import type { FieldType, DiaryFieldValue } from "@/lib/types";

// Diary trend summaries (PRD §5.9). Pure, deterministic — turns logged diary
// entries into a per-field "what changed over time" view: a series for charting
// plus a range (min / max / latest / average) for numeric fields, frequency for
// yes/no, and a distribution for choice fields. No LLM, no advice — a factual
// record of what was logged. American English.

export type TrendField = {
  id: string;
  name: string;
  field_type: FieldType;
  unit: string | null;
  category_options: string[] | null;
};

export type TrendEntry = {
  /** local calendar day, YYYY-MM-DD */
  date: string;
  field_values: Record<string, DiaryFieldValue>;
};

export type NumericTrend = {
  kind: "numeric";
  points: { date: string; value: number }[];
  latest: number;
  min: number;
  max: number;
  avg: number;
  count: number;
};

export type BooleanTrend = {
  kind: "boolean";
  points: { date: string; value: boolean }[];
  yes: number;
  total: number;
};

export type DistributionTrend = {
  kind: "distribution";
  counts: { option: string; count: number }[];
  total: number;
};

export type TextTrend = {
  kind: "text";
  recent: { date: string; text: string }[];
};

export type EmptyTrend = { kind: "empty" };

export type FieldTrend =
  | NumericTrend
  | BooleanTrend
  | DistributionTrend
  | TextTrend
  | EmptyTrend;

const NUMERIC_TYPES = new Set<FieldType>(["number", "scale_1_10"]);

/** Per field: the latest non-cleared value for each day, oldest day first. */
function dayValues(
  fieldId: string,
  entries: TrendEntry[]
): { date: string; value: DiaryFieldValue }[] {
  const byDate = new Map<string, DiaryFieldValue>();
  // Process oldest → newest so a later same-day entry wins; a cleared value
  // (null / "" / []) removes the day.
  const sorted = [...entries].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );
  for (const e of sorted) {
    if (!(fieldId in e.field_values)) continue;
    const v = e.field_values[fieldId];
    const cleared =
      v === null ||
      v === undefined ||
      v === "" ||
      (Array.isArray(v) && v.length === 0);
    if (cleared) byDate.delete(e.date);
    else byDate.set(e.date, v);
  }
  return [...byDate.entries()].map(([date, value]) => ({ date, value }));
}

function summarize(
  field: TrendField,
  values: { date: string; value: DiaryFieldValue }[],
  textLimit: number
): FieldTrend {
  if (NUMERIC_TYPES.has(field.field_type)) {
    const points = values
      .map((d) => ({ date: d.date, value: Number(d.value) }))
      .filter((p) => Number.isFinite(p.value));
    if (points.length === 0) return { kind: "empty" };
    const nums = points.map((p) => p.value);
    const sum = nums.reduce((a, b) => a + b, 0);
    return {
      kind: "numeric",
      points,
      latest: nums[nums.length - 1],
      min: Math.min(...nums),
      max: Math.max(...nums),
      avg: sum / nums.length,
      count: points.length,
    };
  }

  if (field.field_type === "boolean") {
    const points = values
      .filter((d) => typeof d.value === "boolean")
      .map((d) => ({ date: d.date, value: d.value as boolean }));
    if (points.length === 0) return { kind: "empty" };
    return {
      kind: "boolean",
      points,
      yes: points.filter((p) => p.value).length,
      total: points.length,
    };
  }

  if (field.field_type === "category" || field.field_type === "multiselect") {
    const counts = new Map<string, number>();
    let total = 0;
    for (const d of values) {
      const opts =
        field.field_type === "multiselect" && Array.isArray(d.value)
          ? (d.value as string[])
          : typeof d.value === "string"
            ? [d.value]
            : [];
      if (opts.length === 0) continue;
      total += 1;
      for (const o of opts) counts.set(o, (counts.get(o) ?? 0) + 1);
    }
    if (total === 0) return { kind: "empty" };
    return {
      kind: "distribution",
      counts: [...counts.entries()]
        .map(([option, count]) => ({ option, count }))
        .sort((a, b) => b.count - a.count),
      total,
    };
  }

  // freetext
  const recent = values
    .filter((d) => typeof d.value === "string" && d.value.trim())
    .slice(-textLimit)
    .reverse()
    .map((d) => ({ date: d.date, text: String(d.value) }));
  if (recent.length === 0) return { kind: "empty" };
  return { kind: "text", recent };
}

/**
 * Build a trend summary for each field from the patient's logged diary entries.
 * Fields keep their configured order; entries may arrive in any order.
 */
export function buildTrends(
  fields: TrendField[],
  entries: TrendEntry[],
  opts: { textLimit?: number } = {}
): { field: TrendField; trend: FieldTrend }[] {
  const textLimit = opts.textLimit ?? 5;
  return fields.map((field) => ({
    field,
    trend: summarize(field, dayValues(field.id, entries), textLimit),
  }));
}
