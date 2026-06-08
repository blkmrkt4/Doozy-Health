// Medication setup checklist (PRD §5.1–5.3). Pure, deterministic, no I/O — given
// the medication's already-loaded rows it returns "what this medication needs and
// what's still missing." Data-bearing requirements (label, prescription, diluent,
// syringe) are COMPUTED from existing columns so there's no parallel "satisfied"
// flag to drift; awareness-only accessories (spacer, oral syringe…) are passed in
// from the stored list. Copy stays factual (§6.1) — it names what's referenced and
// never tells the user to dose or what to buy.

import {
  DOSE_UNITS,
  INJECTABLE_FORM_TYPES,
  type FormType,
} from "@/lib/types";

export type SetupTier = "must" | "conditional" | "awareness";

export type SetupItem = {
  key: string;
  label: string;
  tier: SetupTier;
  satisfied: boolean;
  /** Neutral nudge — "add a photo or enter it", never directive about the drug. */
  actionHint: string;
  source?: "prescription" | "label" | "inferred" | "rule";
};

type DeliveryLike = {
  form_type?: string | null;
  concentration?: { amount?: number | null } | null;
  syringe_spec?: { capacity_mL?: number | null } | null;
  reconstitution?: {
    requires_reconstitution?: boolean;
    diluent_volume_ml?: number | null;
  } | null;
} | null;

type RegimenLike = {
  dose_amount?: number | string | null;
  dose_unit?: string | null;
  route?: string | null;
  frequency?: unknown;
} | null;

/** Awareness-only supply a prescription/label references (no spec needed). */
export type SetupAccessory = {
  type: string;
  label: string;
  source?: "prescription" | "label" | "inferred";
  acknowledged?: boolean;
};

const INJECTABLE_ROUTES = new Set(["intramuscular", "subcutaneous"]);

function num(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function hasFrequency(freq: unknown): boolean {
  return (
    !!freq &&
    typeof freq === "object" &&
    typeof (freq as { type?: unknown }).type === "string"
  );
}

/**
 * Build the setup checklist. Deterministic rules fire regardless of any
 * extraction: an injectable form/route needs a syringe; a powder
 * (requires_reconstitution) needs its diluent mix volume. Orals that need
 * nothing extra simply yield only the two "must" items.
 */
export function buildSetupChecklist(input: {
  delivery: DeliveryLike;
  prescribed: RegimenLike;
  chosen: RegimenLike;
  /** capacity resolved by the caller (inventory syringe → delivery spec). */
  resolvedSyringeCapacityMl: number | null;
  /** a prescription_scan document is linked to this medication. */
  hasPrescriptionDoc: boolean;
  accessories?: SetupAccessory[];
}): SetupItem[] {
  const { delivery, prescribed, chosen, resolvedSyringeCapacityMl, hasPrescriptionDoc } =
    input;
  const accessories = input.accessories ?? [];
  const items: SetupItem[] = [];

  const formType = (delivery?.form_type ?? "") as FormType;
  const route = String(prescribed?.route ?? chosen?.route ?? "")
    .trim()
    .toLowerCase();
  const injectable =
    (!!delivery && INJECTABLE_FORM_TYPES.has(formType)) ||
    INJECTABLE_ROUTES.has(route);
  const requiresReconstitution =
    delivery?.reconstitution?.requires_reconstitution === true;

  // ── must: the medication's strength/concentration is known ────────────────
  const strengthKnown = num(delivery?.concentration?.amount) > 0;
  items.push({
    key: "label",
    label: "Medication label",
    tier: "must",
    satisfied: strengthKnown,
    actionHint: "Add a photo of the vial or package, or enter its strength.",
    source: "label",
  });

  // ── must: prescription — dose, UNIT, and schedule (units are mandatory for
  //    the draw math). A linked prescription photo also satisfies it. ─────────
  const reg = chosen ?? prescribed;
  const doseOk = num(reg?.dose_amount) > 0;
  const unitOk = (DOSE_UNITS as readonly string[]).includes(
    String(reg?.dose_unit ?? "")
  );
  const scheduleOk =
    hasFrequency(chosen?.frequency) || hasFrequency(prescribed?.frequency);
  items.push({
    key: "prescription",
    label: "Prescription — dose, units & schedule",
    tier: "must",
    satisfied: (doseOk && unitOk && scheduleOk) || hasPrescriptionDoc,
    actionHint:
      "Add a photo of the prescription, or enter the dose, its unit, and how often.",
    source: "prescription",
  });

  // ── conditional: diluent for a powder ─────────────────────────────────────
  if (requiresReconstitution) {
    items.push({
      key: "diluent",
      label: "Bacteriostatic water (this is a powder)",
      tier: "conditional",
      satisfied: num(delivery?.reconstitution?.diluent_volume_ml) > 0,
      actionHint:
        "Add the mix volume your prescription specifies, so the strength can be worked out.",
      source: "rule",
    });
  }

  // ── conditional: syringe for an injectable ────────────────────────────────
  if (injectable) {
    items.push({
      key: "syringe",
      label: "Syringe",
      tier: "conditional",
      satisfied: num(resolvedSyringeCapacityMl) > 0,
      actionHint:
        "Choose the syringe you'll use (or add one) — its size shows the fill line.",
      source: "rule",
    });
  }

  // ── awareness: accessories a prescription/label references ─────────────────
  for (const a of accessories) {
    items.push({
      key: `accessory:${a.type}`,
      label: a.label,
      tier: "awareness",
      satisfied: a.acknowledged === true,
      actionHint: "Optional — mark it once you have it.",
      source: a.source ?? "inferred",
    });
  }

  return items;
}

/** Convenience: are all non-awareness items satisfied? (awareness never blocks) */
export function setupComplete(items: SetupItem[]): boolean {
  return items.every((i) => i.tier === "awareness" || i.satisfied);
}

// ── Required-components → awareness accessories ──────────────────────────────
// The data-bearing components (reconstitution / syringe / diluent) are already
// covered by the deterministic rules above, so they are NOT stored as
// accessories. Only awareness-only supplies are mapped here.
const AWARENESS_ACCESSORY_LABELS: Record<string, string> = {
  spacer: "Spacer",
  face_mask: "Face mask",
  oral_syringe: "Oral syringe",
  dropper: "Dropper",
  pen_needle: "Pen needles",
  nebulizer: "Nebulizer",
  applicator: "Applicator",
  swab: "Alcohol swabs",
  sharps_bin: "Sharps bin",
};

/** Map an extraction's required_components to awareness accessories (deduped). */
export function accessoriesFromRequiredComponents(
  components: { type: string; inferred?: boolean }[],
  docSource: "prescription" | "label"
): SetupAccessory[] {
  const out: SetupAccessory[] = [];
  const seen = new Set<string>();
  for (const c of components) {
    const label = AWARENESS_ACCESSORY_LABELS[c.type];
    if (!label || seen.has(c.type)) continue;
    seen.add(c.type);
    out.push({
      type: c.type,
      label,
      source: c.inferred ? "inferred" : docSource,
      acknowledged: false,
    });
  }
  return out;
}

/** Merge incoming accessories into existing, preserving prior acknowledged state
 *  so re-running extraction is idempotent and never resurfaces a dismissed one. */
export function mergeAccessories(
  existing: SetupAccessory[],
  incoming: SetupAccessory[]
): SetupAccessory[] {
  const byType = new Map(existing.map((a) => [a.type, a]));
  for (const a of incoming) {
    const prev = byType.get(a.type);
    byType.set(a.type, prev ? { ...a, acknowledged: prev.acknowledged } : a);
  }
  return [...byType.values()];
}
