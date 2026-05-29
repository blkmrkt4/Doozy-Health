import {
  ROUTE_LABELS,
  isFrequency,
  isRoute,
  type Frequency,
} from "@/lib/types";

// Human-readable, British-English renderings for the medication card and
// detail views. Neutral tone — no urgency, no directive language (PRD §6.1).

const UNIT_PLURAL: Record<string, string> = {
  hour: "hours",
  day: "days",
  week: "weeks",
  month: "months",
};

/** "200 mg" — dose amount + unit, trimmed of trailing zeros. */
export function formatDose(amount: number | string, unit: string): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return `— ${unit}`;
  // Strip trailing zeros without forcing scientific notation.
  const text = n.toString();
  return `${text} ${unit}`;
}

/** "every week", "3 times per week", "as needed". */
export function formatFrequency(freq: unknown): string {
  if (!isFrequency(freq)) return "schedule not set";
  const f = freq as Frequency;
  if (f.type === "as_needed") return "as needed";
  if (f.type === "every") {
    if (f.interval === 1) return `every ${f.unit}`;
    return `every ${f.interval} ${UNIT_PLURAL[f.unit] ?? f.unit}`;
  }
  // times_per
  return `${f.count}× per ${f.period}`;
}

/** "Intramuscular (IM)" or the raw value if unrecognised. */
export function formatRoute(route: unknown): string {
  if (isRoute(route)) return ROUTE_LABELS[route];
  return typeof route === "string" ? route : "—";
}

/** "200 mg · every week · Oral" — one-line regimen summary for a card. */
export function formatRegimenSummary(params: {
  dose_amount: number | string;
  dose_unit: string;
  frequency: unknown;
  route: unknown;
}): string {
  return [
    formatDose(params.dose_amount, params.dose_unit),
    formatFrequency(params.frequency),
    formatRoute(params.route),
  ].join(" · ");
}

/** Neutral staleness phrasing (PRD §9): "logged 4 days ago", never accusatory. */
export function relativeAge(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "never";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return "1 week ago";
  if (weeks < 5) return `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  return months <= 1 ? "1 month ago" : `${months} months ago`;
}
