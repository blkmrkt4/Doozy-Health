// WellKept — domain enums and shapes. These mirror the CHECK constraints
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
  "ophthalmic",
  "otic",
  "nasal",
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
  ophthalmic: "Ophthalmic (eye)",
  otic: "Otic (ear)",
  nasal: "Nasal",
};

// Map free-text / OCR'd route phrasings (e.g. "by mouth", "sub-Q", "PO") onto a
// canonical Route so an extracted human-readable label still validates and saves
// (PRD §5.2). Returns null if nothing recognisable matches.
export function normaliseRoute(raw: string): Route | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if ((ROUTES as readonly string[]).includes(s)) return s as Route;

  const exact: Record<string, Route> = {
    "by mouth": "oral", mouth: "oral", orally: "oral", po: "oral",
    "p.o.": "oral", "per os": "oral",
    "under the tongue": "sublingual", sublingually: "sublingual", sl: "sublingual",
    intramuscularly: "intramuscular", im: "intramuscular", "i.m.": "intramuscular",
    "into the muscle": "intramuscular",
    subcutaneously: "subcutaneous", subcut: "subcutaneous", "sub-q": "subcutaneous",
    subq: "subcutaneous", "sub q": "subcutaneous", sc: "subcutaneous",
    sq: "subcutaneous", "under the skin": "subcutaneous",
    "through the skin": "transdermal",
    rectal: "suppository", rectally: "suppository", pr: "suppository",
    "per rectum": "suppository",
    topically: "topical", "on the skin": "topical", "apply to skin": "topical",
    inhalation: "inhaled", "by inhalation": "inhaled", inhale: "inhaled",
    nebulised: "inhaled", nebulized: "inhaled",
    // Eyes / ears / nose — drops & sprays applied locally (e.g. latanoprost).
    ophthalmically: "ophthalmic", "in both eyes": "ophthalmic",
    "in the eye": "ophthalmic", "in the eyes": "ophthalmic", "each eye": "ophthalmic",
    "both eyes": "ophthalmic", eye: "ophthalmic", eyes: "ophthalmic",
    ocular: "ophthalmic", intraocular: "ophthalmic",
    otically: "otic", "in both ears": "otic", "in the ear": "otic",
    "each ear": "otic", ear: "otic", ears: "otic", aural: "otic",
    intranasal: "nasal", intranasally: "nasal", "in the nose": "nasal",
    "each nostril": "nasal", nostril: "nasal", nose: "nasal",
  };
  if (exact[s]) return exact[s];

  // Loose contains-based fallback for longer descriptive phrases.
  if (s.includes("mouth") || s.includes("oral")) return "oral";
  if (s.includes("tongue") || s.includes("sublingual")) return "sublingual";
  if (s.includes("muscle") || s.includes("intramuscular")) return "intramuscular";
  if (s.includes("subcut") || s.includes("sub-q") || s.includes("under the skin"))
    return "subcutaneous";
  if (s.includes("transdermal") || s.includes("patch")) return "transdermal";
  if (s.includes("rectal") || s.includes("suppository")) return "suppository";
  if (s.includes("inhal") || s.includes("nebuli")) return "inhaled";
  if (s.includes("eye") || s.includes("ophthalm") || s.includes("ocular"))
    return "ophthalmic";
  if (s.includes("ear") || s.includes("otic") || s.includes("aural")) return "otic";
  if (s.includes("nasal") || s.includes("nostril") || s.includes("nose"))
    return "nasal";
  if (s.includes("topical") || s.includes("skin")) return "topical";
  return null;
}

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
  // Count units for solid oral forms — the dose is "take N tablets/capsules",
  // each carrying the medication's per-unit strength (PRD §5.11). The PK engine
  // converts these to mg via the per-unit strength, not a weight factor.
  "tablet",
  "capsule",
] as const;
export type DoseUnit = (typeof DOSE_UNITS)[number];

// Dose units that are a COUNT of a solid form rather than a mass/volume — the
// dose is "1 tablet", and the active amount comes from the per-unit strength.
export const COUNT_DOSE_UNITS: ReadonlySet<string> = new Set([
  "tablet",
  "capsule",
]);

export function isCountDoseUnit(unit: string): boolean {
  return COUNT_DOSE_UNITS.has(unit);
}

// ── Delivery form types (PRD §8) ────────────────────────────────────────────
export const FORM_TYPES = [
  "tablet",
  "capsule",
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
  tablet: "Tablet",
  capsule: "Capsule",
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

export function isInjectableForm(form: FormType): boolean {
  return INJECTABLE_FORM_TYPES.has(form);
}

// Best-guess delivery form from what the label gave us, so a scanned pill bottle
// doesn't default to an injectable vial. A real liquid concentration (mg per
// some mL) ⇒ vial; an oral route with no such concentration ⇒ pill bottle.
export function guessFormType(opts: {
  route: string;
  concentrationAmount: number | null;
  concentrationPerVolume: number | null;
}): FormType {
  const hasLiquidConcentration =
    (opts.concentrationAmount ?? 0) > 0 && (opts.concentrationPerVolume ?? 0) > 0;
  if (hasLiquidConcentration) return "vial";
  const route = opts.route.trim().toLowerCase();
  if (route === "intramuscular" || route === "subcutaneous") return "vial";
  if (route === "transdermal") return "patch";
  if (route === "inhaled") return "inhaler";
  if (route === "suppository") return "suppository";
  // Drops & sprays (eye/ear/nose) are topical liquids — never an injectable.
  if (route === "topical" || route === "ophthalmic" || route === "otic" || route === "nasal")
    return "topical";
  if (route === "sublingual") return "sublingual";
  // Oral or unknown, no liquid concentration ⇒ a solid pill, i.e. a tablet.
  return "tablet";
}

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

const WORD_NUMBERS: Record<string, number> = {
  once: 1, one: 1, a: 1, twice: 2, two: 2, thrice: 3, three: 3, four: 4,
  five: 5, six: 6,
};

/**
 * Parse a free-text cadence phrase (as read off a label) into a structured
 * Frequency, deterministically — no LLM (rule #8). Returns null when nothing
 * recognisable matches, so the review screen can leave the picker on a safe
 * default for the user to set. Cadence ONLY: time-of-day hints like "before
 * bed" or site hints like "in both eyes" are ignored here and kept verbatim in
 * Directions instead.
 */
export function normaliseFrequency(raw: string): Frequency | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  if (/\b(as needed|as required|when needed|prn|p\.r\.n\.)\b/.test(s)) {
    return { type: "as_needed" };
  }

  // every other day / alternate days
  if (/\b(every other day|alternate days?|q\.?o\.?d\.?)\b/.test(s)) {
    return { type: "every", interval: 2, unit: "day" };
  }

  // Latin shorthand: qd / bid / tid / qid, and qNh (e.g. q8h).
  if (/\bq\.?d\.?\b|\bo\.?d\.?\b/.test(s)) return { type: "every", interval: 1, unit: "day" };
  if (/\bb\.?i\.?d\.?\b/.test(s)) return { type: "times_per", count: 2, period: "day" };
  if (/\bt\.?i\.?d\.?\b/.test(s)) return { type: "times_per", count: 3, period: "day" };
  if (/\bq\.?i\.?d\.?\b/.test(s)) return { type: "times_per", count: 4, period: "day" };
  const qh = s.match(/\bq\.?\s*(\d+)\s*h(ours?)?\b/);
  if (qh) return { type: "every", interval: Number(qh[1]), unit: "hour" };

  // "every N hours/days/weeks/months" (N is a digit or a word number).
  const everyN = s.match(
    /\bevery\s+(\d+|once|one|two|three|a)?\s*(hour|day|week|month)s?\b/
  );
  if (everyN) {
    const n = everyN[1] ? WORD_NUMBERS[everyN[1]] ?? (Number(everyN[1]) || 1) : 1;
    return { type: "every", interval: n, unit: everyN[2] as "hour" | "day" | "week" | "month" };
  }

  // "N times (a|per) day/week"
  const timesPer = s.match(
    /\b(once|twice|thrice|one|two|three|four|five|six|\d+)\s*(?:times?|x)?\s*(?:a|per|\/)\s*(day|daily|week|weekly)\b/
  );
  if (timesPer) {
    const count = WORD_NUMBERS[timesPer[1]] ?? (Number(timesPer[1]) || 1);
    const period = timesPer[2].startsWith("week") ? "week" : "day";
    // Once-per-X reads more naturally as "every 1 X" than "1 time per X".
    if (count <= 1) return { type: "every", interval: 1, unit: period };
    return { type: "times_per", count, period };
  }

  // Bare adverbs: daily / weekly / monthly (and "every day/week/month").
  if (/\b(daily|every day|each day)\b/.test(s)) return { type: "every", interval: 1, unit: "day" };
  if (/\b(weekly|every week|each week|once a week)\b/.test(s)) return { type: "every", interval: 1, unit: "week" };
  if (/\b(monthly|every month|each month|once a month)\b/.test(s)) return { type: "every", interval: 1, unit: "month" };
  if (/\b(twice (?:a |per )?weekly?)\b/.test(s)) return { type: "times_per", count: 2, period: "week" };

  return null;
}

// ── Concentration / syringe spec (delivery form jsonb) ──────────────────────
// For liquids the concentration is an amount per mL (e.g. 200 mg / 1 mL). For
// solid oral forms we reuse the same shape to store the per-unit STRENGTH, with
// volume_unit set to the count unit (e.g. 10 mg / 1 tablet) — see §5.11.
export type Concentration = {
  amount: number;
  unit: DoseUnit;
  per_volume: number;
  volume_unit: "mL" | "tablet" | "capsule";
};

// Reconstitution metadata (PRD §5.2): how a lyophilized powder was prepared.
// The working numbers live in Concentration (amount = total active in the vial,
// per_volume = the diluent volume the user added per their prescription); this
// records the provenance for display. The app never suggests the volume.
export type Reconstitution = {
  requires_reconstitution: boolean;
  diluent_type: string;
  diluent_volume_ml: number;
  powder_amount: number;
  powder_unit: DoseUnit;
  note?: string;
};

/** Common reconstitution diluents (for the picker). American English. */
export const DILUENTS = [
  "bacteriostatic water",
  "sterile water",
  "0.9% sodium chloride",
] as const;

export type SyringeSpec = {
  capacity_mL: number;
  needle_gauge: number;
  needle_length_in: number;
  unit_markings: string;
};

// Inventory item — supplies on hand (syringes for now), not a medication.
// Mirrors the inventory_items table (migration 20260605000001).
export type InventoryItem = {
  id: string;
  patient_id: string;
  category: "syringe";
  label: string;
  spec: Partial<SyringeSpec>;
  photo_document_id: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

// ── Diary / tracked fields (PRD §5.9) ───────────────────────────────────────
export const FIELD_TYPES = [
  "number",
  "scale_1_10",
  "boolean",
  "freetext",
  "category",
  "multiselect",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  number: "Number",
  scale_1_10: "1–10 scale",
  boolean: "Yes / No",
  freetext: "Free text",
  category: "Single choice",
  multiselect: "Multiple choice",
};

export function isFieldType(v: string): v is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(v);
}

// Daily vs periodic (labs/measurements). Periodic fields are logged "when you
// have a result" and stay out of the daily entry form (PRD §5.9).
export const FIELD_CADENCES = ["daily", "periodic"] as const;
export type FieldCadence = (typeof FIELD_CADENCES)[number];

export function isFieldCadence(v: string): v is FieldCadence {
  return (FIELD_CADENCES as readonly string[]).includes(v);
}

export type TrackedField = {
  id: string;
  patient_id?: string;
  name: string;
  field_type: FieldType;
  unit: string | null;
  category_options: string[] | null;
  display_order?: number;
  active?: boolean;
  cadence?: FieldCadence;
  /** medication_ids this field is scoped to; empty = applies to all (general). */
  medicationIds?: string[];
};

// Patient sex — used only to order/filter which diary templates are visible
// (never to auto-select anything). Keyed to the patient, not the account holder.
export const PATIENT_SEXES = ["male", "female"] as const;
export type PatientSex = (typeof PATIENT_SEXES)[number];

export function isPatientSex(v: string): v is PatientSex {
  return (PATIENT_SEXES as readonly string[]).includes(v);
}

export type DiaryFieldValue = string | number | boolean | string[] | null;

export type DiaryEntry = {
  id: string;
  entry_at: string;
  entry_date: string | null;
  field_values: Record<string, DiaryFieldValue>;
  note: string | null;
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
