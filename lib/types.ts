// Doozy Health — domain enums and shapes. These mirror the CHECK constraints
// in the migrations; keep the two in sync. British English in labels (PRD §6.1).

// ── Routes of administration (PRD §4.2) ─────────────────────────────────────
export const ROUTES = [
  "oral",
  "sublingual",
  "intramuscular",
  "subcutaneous",
  "transdermal",
  "suppository",
  "topical",
  "inhaled",
] as const;
export type Route = (typeof ROUTES)[number];

export const ROUTE_LABELS: Record<Route, string> = {
  oral: "Oral",
  sublingual: "Sublingual",
  intramuscular: "Intramuscular (IM)",
  subcutaneous: "Subcutaneous (sub-Q)",
  transdermal: "Transdermal",
  suppository: "Suppository",
  topical: "Topical",
  inhaled: "Inhaled",
};

// ── Dose units (native units, PRD §5.11) ────────────────────────────────────
export const DOSE_UNITS = [
  "mg",
  "mcg",
  "g",
  "mL",
  "IU",
  "unit",
  "grain",
  "puff",
  "drop",
  "patch",
  "application",
] as const;
export type DoseUnit = (typeof DOSE_UNITS)[number];

// ── Delivery form types (PRD §8) ────────────────────────────────────────────
export const FORM_TYPES = [
  "vial",
  "patch",
  "pill_bottle",
  "suppository",
  "topical",
  "inhaler",
  "sublingual",
] as const;
export type FormType = (typeof FORM_TYPES)[number];

export const FORM_TYPE_LABELS: Record<FormType, string> = {
  vial: "Vial",
  patch: "Patch",
  pill_bottle: "Pill bottle",
  suppository: "Suppository",
  topical: "Topical",
  inhaler: "Inhaler",
  sublingual: "Sublingual",
};

// Forms drawn up in a syringe — the only ones that take a syringe spec and the
// calibrated syringe visual (PRD §4.3, §9). Used to decide which fields show.
export const INJECTABLE_FORM_TYPES: ReadonlySet<FormType> = new Set<FormType>([
  "vial",
]);

// ── Membership roles (PRD §5.6) ─────────────────────────────────────────────
export type MembershipRole = "owner" | "caregiver" | "viewer";

// ── Frequency / cadence ─────────────────────────────────────────────────────
// How often a dose is taken. Dose AMOUNT is stored separately (dose_amount);
// this captures only cadence. Consumed by the reminders engine (step 12) and
// the PK chart (step 11). Stored as jsonb in *_regimens.frequency.
export type Frequency =
  | { type: "every"; interval: number; unit: "hour" | "day" | "week" | "month" }
  | { type: "times_per"; count: number; period: "day" | "week" }
  | { type: "as_needed" };

export const FREQUENCY_UNITS = ["hour", "day", "week", "month"] as const;
export const FREQUENCY_PERIODS = ["day", "week"] as const;

// ── Concentration / syringe spec (delivery form jsonb) ──────────────────────
export type Concentration = {
  amount: number;
  unit: DoseUnit;
  per_volume: number;
  volume_unit: "mL";
};

export type SyringeSpec = {
  capacity_mL: number;
  needle_gauge: number;
  needle_length_in: number;
  unit_markings: string;
};

// ── Type guards / validators (defensive — never trust jsonb blindly) ────────
export function isRoute(v: unknown): v is Route {
  return typeof v === "string" && (ROUTES as readonly string[]).includes(v);
}

export function isDoseUnit(v: unknown): v is DoseUnit {
  return typeof v === "string" && (DOSE_UNITS as readonly string[]).includes(v);
}

export function isFormType(v: unknown): v is FormType {
  return typeof v === "string" && (FORM_TYPES as readonly string[]).includes(v);
}

export function isFrequency(v: unknown): v is Frequency {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  if (f.type === "as_needed") return true;
  if (f.type === "every") {
    return (
      typeof f.interval === "number" &&
      f.interval > 0 &&
      typeof f.unit === "string" &&
      (FREQUENCY_UNITS as readonly string[]).includes(f.unit)
    );
  }
  if (f.type === "times_per") {
    return (
      typeof f.count === "number" &&
      f.count > 0 &&
      typeof f.period === "string" &&
      (FREQUENCY_PERIODS as readonly string[]).includes(f.period)
    );
  }
  return false;
}

// ── Admin / LLM infrastructure (PRD §14) ───────────────────────────────────
export const PROMPT_PURPOSES = [
  "extraction",
  "classification",
  "summary",
  "other",
] as const;
export type PromptPurpose = (typeof PROMPT_PURPOSES)[number];

export const PROMPT_STATUSES = ["active", "disabled"] as const;
export type PromptStatus = (typeof PROMPT_STATUSES)[number];

export const RESPONSE_FORMATS = ["text", "json"] as const;
export type ResponseFormat = (typeof RESPONSE_FORMATS)[number];

export const DELTA_DIRECTIONS = ["llm_to_user", "user_to_llm"] as const;
export type DeltaDirection = (typeof DELTA_DIRECTIONS)[number];

export const LLM_CONFIDENCES = ["high", "medium", "low"] as const;
export type LlmConfidence = (typeof LLM_CONFIDENCES)[number];

export const ADMIN_ANNOTATIONS = [
  "unreviewed",
  "expected",
  "extraction_miss",
] as const;
export type AdminAnnotation = (typeof ADMIN_ANNOTATIONS)[number];

export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "view_source",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
