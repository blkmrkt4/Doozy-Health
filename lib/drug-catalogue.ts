// Curated drug reference catalogue (PRD §5.7, §5.8). This is the GROUND TRUTH
// for pharmacokinetics and interactions. RxNorm supplies identity (rxnorm_id)
// during sync; the pharmacokinetic parameters here are textbook approximations
// curated by hand — RxNorm carries none of them, and the PK engine (step 11)
// reads them. Values are illustrative, not clinical (PRD §6.1).
//
// Route keys MUST match the Route enum in lib/types.ts.

export type CatalogueDrug = {
  canonical_name: string;
  atc_class?: string;
  /** Elimination half-life in hours, keyed by route. */
  half_life_hours: Record<string, number>;
  /** Bioavailability 0..1, keyed by route. */
  bioavailability?: Record<string, number>;
  /** Time-to-peak in hours, keyed by route. */
  tmax_hours?: Record<string, number>;
  controlled_schedule?: string;
  reference_data?: Record<string, unknown>;
};

export type CatalogueInteraction = {
  a: string; // canonical_name
  b: string; // canonical_name
  severity: "info" | "caution" | "serious";
  /** Short technical mechanism summary — informational, never directive. */
  mechanism: string;
};

const TEXTBOOK = { source: "textbook PK (illustrative, not clinical)" };

export const DRUG_CATALOGUE: CatalogueDrug[] = [
  {
    canonical_name: "testosterone cypionate",
    atc_class: "G03BA03",
    half_life_hours: { intramuscular: 192 },
    bioavailability: { intramuscular: 1.0 },
    tmax_hours: { intramuscular: 96 },
    controlled_schedule: "CIII",
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "testosterone enanthate",
    atc_class: "G03BA03",
    half_life_hours: { intramuscular: 108 },
    bioavailability: { intramuscular: 1.0 },
    tmax_hours: { intramuscular: 72 },
    controlled_schedule: "CIII",
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "estradiol",
    atc_class: "G03CA03",
    half_life_hours: { oral: 15, transdermal: 15 },
    bioavailability: { oral: 0.05, transdermal: 1.0 },
    tmax_hours: { oral: 5, transdermal: 24 },
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "levothyroxine",
    atc_class: "H03AA01",
    half_life_hours: { oral: 168 },
    bioavailability: { oral: 0.7 },
    tmax_hours: { oral: 3 },
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "methylphenidate",
    atc_class: "N06BA04",
    half_life_hours: { oral: 3 },
    bioavailability: { oral: 0.3 },
    tmax_hours: { oral: 2 },
    controlled_schedule: "CII",
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "lisdexamfetamine",
    atc_class: "N06BA12",
    half_life_hours: { oral: 11 },
    bioavailability: { oral: 0.9 },
    tmax_hours: { oral: 3.5 },
    controlled_schedule: "CII",
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "sertraline",
    atc_class: "N06AB06",
    half_life_hours: { oral: 26 },
    bioavailability: { oral: 0.44 },
    tmax_hours: { oral: 6 },
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "fluoxetine",
    atc_class: "N06AB03",
    half_life_hours: { oral: 96 },
    bioavailability: { oral: 0.72 },
    tmax_hours: { oral: 6 },
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "escitalopram",
    atc_class: "N06AB10",
    half_life_hours: { oral: 30 },
    bioavailability: { oral: 0.8 },
    tmax_hours: { oral: 5 },
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "bupropion",
    atc_class: "N06AX12",
    half_life_hours: { oral: 21 },
    tmax_hours: { oral: 3 },
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "tramadol",
    atc_class: "N02AX02",
    half_life_hours: { oral: 6 },
    bioavailability: { oral: 0.7 },
    tmax_hours: { oral: 2 },
    controlled_schedule: "CIV",
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "oxycodone",
    atc_class: "N02AA05",
    half_life_hours: { oral: 3.5 },
    bioavailability: { oral: 0.6 },
    tmax_hours: { oral: 1.5 },
    controlled_schedule: "CII",
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "metformin",
    atc_class: "A10BA02",
    half_life_hours: { oral: 6 },
    bioavailability: { oral: 0.55 },
    tmax_hours: { oral: 2.5 },
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "lamotrigine",
    atc_class: "N03AX09",
    half_life_hours: { oral: 29 },
    bioavailability: { oral: 0.98 },
    tmax_hours: { oral: 2 },
    reference_data: TEXTBOOK,
  },
];

export const INTERACTION_CATALOGUE: CatalogueInteraction[] = [
  {
    a: "sertraline",
    b: "tramadol",
    severity: "serious",
    mechanism:
      "Both increase central serotonin; combined use raises the risk of serotonin syndrome.",
  },
  {
    a: "fluoxetine",
    b: "tramadol",
    severity: "serious",
    mechanism:
      "Serotonergic combination; fluoxetine also inhibits CYP2D6, altering tramadol metabolism.",
  },
  {
    a: "escitalopram",
    b: "tramadol",
    severity: "serious",
    mechanism:
      "Both increase central serotonin; combined use raises the risk of serotonin syndrome.",
  },
  {
    a: "oxycodone",
    b: "tramadol",
    severity: "serious",
    mechanism:
      "Two opioids together produce additive central-nervous-system and respiratory depression.",
  },
  {
    a: "bupropion",
    b: "sertraline",
    severity: "caution",
    mechanism:
      "Bupropion lowers the seizure threshold and inhibits CYP2D6, which can raise sertraline exposure.",
  },
  {
    a: "methylphenidate",
    b: "sertraline",
    severity: "caution",
    mechanism:
      "Potential additive stimulatory and serotonergic effects; blood pressure and mood worth monitoring.",
  },
];
