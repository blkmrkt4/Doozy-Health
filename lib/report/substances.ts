// Bridge between tracked diary fields and curated drug rows (PRD §5.8, §5.10.1).
// A user typically tracks alcohol/caffeine/nicotine as a *diary field*, not a
// medication — but those substances exist in the curated `drugs` catalogue, so a
// tracked substance can be matched against the curated `drug_interactions` table
// (e.g. alcohol × citalopram). This map is the only place that link is defined;
// it never invents an interaction (hard rule #9) — it just maps a field name to a
// canonical drug name so the curated lookup can run. American English.

/** Normalize a field name for matching (lowercase, trimmed, no trailing notes). */
function norm(name: string): string {
  return name.trim().toLowerCase();
}

// Field-name (normalized) → canonical drug name in DRUG_CATALOGUE / `drugs`.
const SUBSTANCE_BY_FIELD: Record<string, string> = {
  alcohol: "alcohol",
  "alcohol (drinks)": "alcohol",
  drinks: "alcohol",
  caffeine: "caffeine",
  coffee: "caffeine",
  nicotine: "nicotine",
  cigarettes: "nicotine",
  smoking: "nicotine",
};

/** The canonical drug name a tracked field maps to, or null if it isn't a substance. */
export function substanceForField(fieldName: string): string | null {
  return SUBSTANCE_BY_FIELD[norm(fieldName)] ?? null;
}

export function isSubstanceField(fieldName: string): boolean {
  return substanceForField(fieldName) !== null;
}
