// Curated drug reference catalogue (PRD §5.7, §5.8). This is the GROUND TRUTH
// for pharmacokinetics and interactions. RxNorm supplies identity (rxnorm_id)
// during sync; the pharmacokinetic parameters here are textbook approximations
// curated by hand — RxNorm carries none of them, and the PK engine reads them.
// Values are illustrative, not clinical (PRD §6.1).
//
// v0.4 additions: kernel_by_route, half_life_range_hours, is_linear,
// metabolites, release_duration_hours. Route keys MUST match lib/types.ts.

export type KernelType = "exponential" | "bateman" | "zeroOrder";

export type CatalogueMetabolite = {
  name: string;
  /** Fraction of parent dose converted to this metabolite (0..1). */
  fraction: number;
  kernel: KernelType;
  half_life_hours: number;
  tmax_hours: number;
};

export type CatalogueDrug = {
  canonical_name: string;
  atc_class?: string;
  /** Elimination half-life in hours, keyed by route. */
  half_life_hours: Record<string, number>;
  /** Population half-life range [low, high] for the uncertainty band. */
  half_life_range_hours?: Record<string, [number, number]>;
  /** Bioavailability 0..1, keyed by route. */
  bioavailability?: Record<string, number>;
  /** Time-to-peak in hours, keyed by route. */
  tmax_hours?: Record<string, number>;
  /** Per-route kernel selection (§5.7). */
  kernel_by_route?: Record<string, KernelType>;
  /** Release duration for zero-order kernels (patches, implants). */
  release_duration_hours?: Record<string, number>;
  /** Linearity gate (§5.7). False = no curve rendered. */
  is_linear?: boolean;
  /** Reason shown when is_linear = false. */
  nonlinear_reason?: string;
  /** Active metabolites with their own PK params. */
  metabolites?: CatalogueMetabolite[];
  controlled_schedule?: string;
  reference_data?: Record<string, unknown>;
};

export type CatalogueInteraction = {
  a: string;
  b: string;
  severity: "info" | "caution" | "serious";
  mechanism: string;
};

const TEXTBOOK = { source: "textbook PK (illustrative, not clinical)" };
const CURATED = { source: "curated reference (illustrative, not clinical)" };

export const DRUG_CATALOGUE: CatalogueDrug[] = [
  {
    canonical_name: "testosterone cypionate",
    atc_class: "G03BA03",
    half_life_hours: { intramuscular: 192 },
    half_life_range_hours: { intramuscular: [144, 240] },
    bioavailability: { intramuscular: 1.0 },
    tmax_hours: { intramuscular: 96 },
    kernel_by_route: { intramuscular: "bateman" },
    is_linear: true,
    controlled_schedule: "CIII",
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "testosterone enanthate",
    atc_class: "G03BA03",
    half_life_hours: { intramuscular: 108 },
    half_life_range_hours: { intramuscular: [84, 132] },
    bioavailability: { intramuscular: 1.0 },
    tmax_hours: { intramuscular: 72 },
    kernel_by_route: { intramuscular: "bateman" },
    is_linear: true,
    controlled_schedule: "CIII",
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "estradiol",
    atc_class: "G03CA03",
    half_life_hours: { oral: 15, transdermal: 15 },
    half_life_range_hours: { oral: [12, 20], transdermal: [12, 20] },
    bioavailability: { oral: 0.05, transdermal: 1.0 },
    tmax_hours: { oral: 5, transdermal: 24 },
    kernel_by_route: { oral: "bateman", transdermal: "zeroOrder" },
    release_duration_hours: { transdermal: 84 }, // 3.5-day patch
    is_linear: true,
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "levothyroxine",
    atc_class: "H03AA01",
    half_life_hours: { oral: 168 },
    half_life_range_hours: { oral: [120, 216] },
    bioavailability: { oral: 0.7 },
    tmax_hours: { oral: 3 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "methylphenidate",
    atc_class: "N06BA04",
    half_life_hours: { oral: 3 },
    half_life_range_hours: { oral: [2, 4] },
    bioavailability: { oral: 0.3 },
    tmax_hours: { oral: 2 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    controlled_schedule: "CII",
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "lisdexamfetamine",
    atc_class: "N06BA12",
    half_life_hours: { oral: 11 },
    half_life_range_hours: { oral: [9, 14] },
    bioavailability: { oral: 0.9 },
    tmax_hours: { oral: 3.5 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    // Prodrug: converted to dexamfetamine (the active form).
    metabolites: [
      {
        name: "dexamfetamine",
        fraction: 1.0,
        kernel: "bateman",
        half_life_hours: 11,
        tmax_hours: 3.5,
      },
    ],
    controlled_schedule: "CII",
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "sertraline",
    atc_class: "N06AB06",
    half_life_hours: { oral: 26 },
    half_life_range_hours: { oral: [22, 36] },
    bioavailability: { oral: 0.44 },
    tmax_hours: { oral: 6 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "fluoxetine",
    atc_class: "N06AB03",
    half_life_hours: { oral: 96 },
    half_life_range_hours: { oral: [48, 144] },
    bioavailability: { oral: 0.72 },
    tmax_hours: { oral: 6 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    // Active metabolite: norfluoxetine (longer half-life than parent).
    metabolites: [
      {
        name: "norfluoxetine",
        fraction: 0.8,
        kernel: "bateman",
        half_life_hours: 168,
        tmax_hours: 8,
      },
    ],
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "escitalopram",
    atc_class: "N06AB10",
    half_life_hours: { oral: 30 },
    half_life_range_hours: { oral: [27, 33] },
    bioavailability: { oral: 0.8 },
    tmax_hours: { oral: 5 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "bupropion",
    atc_class: "N06AX12",
    half_life_hours: { oral: 21 },
    half_life_range_hours: { oral: [12, 30] },
    tmax_hours: { oral: 3 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "tramadol",
    atc_class: "N02AX02",
    half_life_hours: { oral: 6 },
    half_life_range_hours: { oral: [5, 7] },
    bioavailability: { oral: 0.7 },
    tmax_hours: { oral: 2 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    // Active metabolite: O-desmethyltramadol (more potent, different half-life).
    metabolites: [
      {
        name: "O-desmethyltramadol",
        fraction: 0.2,
        kernel: "bateman",
        half_life_hours: 9,
        tmax_hours: 3,
      },
    ],
    controlled_schedule: "CIV",
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "oxycodone",
    atc_class: "N02AA05",
    half_life_hours: { oral: 3.5 },
    half_life_range_hours: { oral: [2.5, 5] },
    bioavailability: { oral: 0.6 },
    tmax_hours: { oral: 1.5 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    controlled_schedule: "CII",
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "metformin",
    atc_class: "A10BA02",
    half_life_hours: { oral: 6 },
    half_life_range_hours: { oral: [4, 9] },
    bioavailability: { oral: 0.55 },
    tmax_hours: { oral: 2.5 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "lamotrigine",
    atc_class: "N03AX09",
    half_life_hours: { oral: 29 },
    half_life_range_hours: { oral: [15, 35] },
    bioavailability: { oral: 0.98 },
    tmax_hours: { oral: 2 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "citalopram",
    atc_class: "N06AB04",
    half_life_hours: { oral: 35 },
    half_life_range_hours: { oral: [30, 40] },
    bioavailability: { oral: 0.8 },
    tmax_hours: { oral: 4 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "diazepam",
    atc_class: "N05BA01",
    half_life_hours: { oral: 43 },
    half_life_range_hours: { oral: [20, 70] },
    bioavailability: { oral: 0.93 },
    tmax_hours: { oral: 1.25 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    controlled_schedule: "CIV",
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "zolpidem",
    atc_class: "N05CF02",
    half_life_hours: { oral: 2.5 },
    half_life_range_hours: { oral: [1.5, 3.5] },
    bioavailability: { oral: 0.7 },
    tmax_hours: { oral: 1.6 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    controlled_schedule: "CIV",
    reference_data: TEXTBOOK,
  },
  // ── Substances & common OTCs (interaction reference) ──────────────────────
  // PK is illustrative; these mainly exist so a tracked substance (alcohol) or a
  // one-off OTC dose can be matched against the curated drug_interactions table.
  {
    canonical_name: "alcohol",
    atc_class: "V03AB",
    half_life_hours: { oral: 0.5 },
    is_linear: false,
    nonlinear_reason:
      "Alcohol is eliminated by zero-order kinetics (a roughly fixed amount per hour), so a simple half-life curve does not apply.",
    reference_data: CURATED,
  },
  {
    canonical_name: "caffeine",
    atc_class: "N06BC01",
    half_life_hours: { oral: 5 },
    half_life_range_hours: { oral: [3, 7] },
    bioavailability: { oral: 1.0 },
    tmax_hours: { oral: 0.75 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    reference_data: CURATED,
  },
  {
    canonical_name: "nicotine",
    atc_class: "N07BA01",
    half_life_hours: { oral: 2, transdermal: 2 },
    bioavailability: { oral: 0.3, transdermal: 1.0 },
    tmax_hours: { oral: 1, transdermal: 6 },
    kernel_by_route: { oral: "bateman", transdermal: "zeroOrder" },
    release_duration_hours: { transdermal: 24 },
    is_linear: true,
    reference_data: CURATED,
  },
  {
    canonical_name: "acetaminophen",
    atc_class: "N02BE01",
    half_life_hours: { oral: 2.5 },
    half_life_range_hours: { oral: [2, 3] },
    bioavailability: { oral: 0.88 },
    tmax_hours: { oral: 1 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "ibuprofen",
    atc_class: "M01AE01",
    half_life_hours: { oral: 2 },
    half_life_range_hours: { oral: [1.8, 2.4] },
    bioavailability: { oral: 0.9 },
    tmax_hours: { oral: 1.5 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "naproxen",
    atc_class: "M01AE02",
    half_life_hours: { oral: 14 },
    half_life_range_hours: { oral: [12, 17] },
    bioavailability: { oral: 0.95 },
    tmax_hours: { oral: 2 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "dextromethorphan",
    atc_class: "R05DA09",
    half_life_hours: { oral: 3.5 },
    half_life_range_hours: { oral: [2, 4] },
    bioavailability: { oral: 0.11 },
    tmax_hours: { oral: 2.5 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "diphenhydramine",
    atc_class: "R06AA02",
    half_life_hours: { oral: 8 },
    half_life_range_hours: { oral: [4, 12] },
    bioavailability: { oral: 0.4 },
    tmax_hours: { oral: 2 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
    reference_data: TEXTBOOK,
  },
  {
    canonical_name: "pseudoephedrine",
    atc_class: "R01BA02",
    half_life_hours: { oral: 6 },
    half_life_range_hours: { oral: [5, 8] },
    bioavailability: { oral: 0.9 },
    tmax_hours: { oral: 2 },
    kernel_by_route: { oral: "bateman" },
    is_linear: true,
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

  // ── Alcohol × CNS-active medications ──────────────────────────────────────
  {
    a: "alcohol",
    b: "citalopram",
    severity: "caution",
    mechanism:
      "Both act on the central nervous system; combined use can increase drowsiness, dizziness, and impaired concentration, and may worsen mood.",
  },
  {
    a: "alcohol",
    b: "escitalopram",
    severity: "caution",
    mechanism:
      "Both act on the central nervous system; combined use can increase drowsiness, dizziness, and impaired concentration, and may worsen mood.",
  },
  {
    a: "alcohol",
    b: "sertraline",
    severity: "caution",
    mechanism:
      "Both act on the central nervous system; combined use can increase drowsiness, dizziness, and impaired concentration, and may worsen mood.",
  },
  {
    a: "alcohol",
    b: "fluoxetine",
    severity: "caution",
    mechanism:
      "Both act on the central nervous system; combined use can increase drowsiness, dizziness, and impaired concentration, and may worsen mood.",
  },
  {
    a: "alcohol",
    b: "bupropion",
    severity: "caution",
    mechanism:
      "Alcohol and bupropion can each affect the seizure threshold; combined use may add to that risk and to central nervous system effects.",
  },
  {
    a: "alcohol",
    b: "diazepam",
    severity: "serious",
    mechanism:
      "Both are central nervous system depressants; together they markedly increase sedation, slowed breathing, and impaired coordination.",
  },
  {
    a: "alcohol",
    b: "zolpidem",
    severity: "serious",
    mechanism:
      "Both depress the central nervous system; combined use increases sedation, impaired coordination, and the chance of complex sleep behaviors.",
  },
  {
    a: "alcohol",
    b: "oxycodone",
    severity: "serious",
    mechanism:
      "Alcohol and opioids together produce additive central nervous system and respiratory depression.",
  },
  {
    a: "alcohol",
    b: "tramadol",
    severity: "serious",
    mechanism:
      "Additive central nervous system depression, and tramadol can also lower the seizure threshold.",
  },
  {
    a: "alcohol",
    b: "diphenhydramine",
    severity: "caution",
    mechanism:
      "Both cause sedation; together they increase drowsiness and impaired alertness.",
  },
  {
    a: "alcohol",
    b: "lamotrigine",
    severity: "info",
    mechanism:
      "Both can cause dizziness or drowsiness; combined use may add to these effects.",
  },

  // ── Alcohol / NSAID × GI or hepatic risk ──────────────────────────────────
  {
    a: "alcohol",
    b: "acetaminophen",
    severity: "caution",
    mechanism:
      "Regular alcohol use together with acetaminophen increases the risk of liver injury.",
  },
  {
    a: "alcohol",
    b: "ibuprofen",
    severity: "caution",
    mechanism:
      "Both can irritate the stomach lining; combined use increases the risk of stomach upset and gastrointestinal bleeding.",
  },
  {
    a: "ibuprofen",
    b: "sertraline",
    severity: "caution",
    mechanism:
      "NSAIDs combined with SSRIs increase the risk of gastrointestinal bleeding.",
  },
  {
    a: "ibuprofen",
    b: "escitalopram",
    severity: "caution",
    mechanism:
      "NSAIDs combined with SSRIs increase the risk of gastrointestinal bleeding.",
  },
  {
    a: "ibuprofen",
    b: "citalopram",
    severity: "caution",
    mechanism:
      "NSAIDs combined with SSRIs increase the risk of gastrointestinal bleeding.",
  },
  {
    a: "naproxen",
    b: "sertraline",
    severity: "caution",
    mechanism:
      "NSAIDs combined with SSRIs increase the risk of gastrointestinal bleeding.",
  },

  // ── Other common OTC pairings ─────────────────────────────────────────────
  {
    a: "pseudoephedrine",
    b: "methylphenidate",
    severity: "caution",
    mechanism:
      "Both are stimulants; combined use can add to increases in heart rate and blood pressure.",
  },
  {
    a: "dextromethorphan",
    b: "sertraline",
    severity: "caution",
    mechanism:
      "Both raise serotonin activity; combined use can increase the risk of serotonin-related effects.",
  },
  {
    a: "dextromethorphan",
    b: "fluoxetine",
    severity: "caution",
    mechanism:
      "Both raise serotonin activity; combined use can increase the risk of serotonin-related effects.",
  },
];
