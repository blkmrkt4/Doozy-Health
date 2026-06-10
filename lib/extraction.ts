import "server-only";
import { llmCall } from "@/lib/llm";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWarn } from "@/lib/log";
import type { LlmConfidence } from "@/lib/types";

// Vial/packaging extraction service (PRD §5.2, §13.8).
// Calls llmCall('extract_vial', ...) and defensively parses the response.
// Extraction NEVER auto-commits — the caller must present a review card
// and write to medication tables only after explicit user confirmation.

// ── Types ──────────────────────────────────────────────────────────────────

export type ExtractedField<T = string> = {
  value: T;
  confidence: LlmConfidence;
};

/**
 * A supply this medication needs that the document may not spell out — the model
 * infers it from the drug + form (a powder ⇒ diluent + syringe; an inhaler ⇒
 * often a spacer). `inferred` distinguishes drug-knowledge from text printed on
 * the document, which drives the §6.1-safe copy ("often used with" vs "your
 * prescription references"). Seeds the setup checklist.
 */
export type RequiredComponent = {
  type: string;
  inferred: boolean;
  confidence: LlmConfidence;
};

export type VialExtraction = {
  drug_name_raw: ExtractedField;
  drug_name_canonical: ExtractedField;
  strength: ExtractedField;
  concentration_amount: ExtractedField<number | null>;
  concentration_unit: ExtractedField;
  concentration_per_volume: ExtractedField<number | null>;
  volume_ml: ExtractedField<number | null>;
  // Reconstitution (PRD §5.2): a lyophilized powder that must be mixed with a
  // diluent before use. For a powder, concentration_amount holds the TOTAL
  // active in the vial and concentration_per_volume is null until mixed; the
  // mix volume comes from the prescription, never the label.
  requires_reconstitution: ExtractedField;
  diluent_type: ExtractedField;
  reconstitution_note: ExtractedField;
  required_components: RequiredComponent[];
  route: ExtractedField;
  // Free-text dosing instructions printed on a dispensed label, e.g.
  // "Take 1 tablet by mouth every morning". Empty for bare manufacturer vials.
  directions: ExtractedField;
  expiry_date: ExtractedField;
  batch: ExtractedField;
  manufacturer: ExtractedField;
};

export type PrescriptionExtraction = {
  drug_name: ExtractedField;
  dose_amount: ExtractedField<number | null>;
  dose_unit: ExtractedField;
  frequency: ExtractedField;
  duration_days: ExtractedField<number | null>;
  route: ExtractedField;
  // The full dosing instruction copied verbatim ("one drop in both eyes once
  // per day before bed"). frequency carries only the structured cadence; the
  // rest of the sentence (time of day, site) is kept here for Directions.
  directions: ExtractedField;
  prescriber: ExtractedField;
  refills: ExtractedField<number | null>;
  // Reconstitution mix instruction (the only place the diluent volume comes
  // from — the prescriber's instruction, never an app suggestion).
  diluent_volume_ml: ExtractedField<number | null>;
  diluent_type: ExtractedField;
  reconstitution_note: ExtractedField;
  required_components: RequiredComponent[];
};

export type ExtractionType = "vial" | "prescription";

export type ExtractionResult =
  | { ok: true; extraction: VialExtraction; type: "vial"; modelUsed: string; promptVersionId: string }
  | { ok: true; extraction: PrescriptionExtraction; type: "prescription"; modelUsed: string; promptVersionId: string }
  // typeMismatch flags "this is actually the other document type" so the caller
  // can transparently re-run with the correct extractor (PRD §5.2) rather than
  // bouncing the user back to re-pick the type.
  | { ok: false; error: string; typeMismatch?: boolean };

// Syringe packaging extraction (PRD §5.1, §14.8). American English. Like the
// vial path, never auto-commits — the caller confirms on a review screen.
export type SyringeExtraction = {
  capacity_ml: ExtractedField<number | null>;
  needle_gauge: ExtractedField<number | null>;
  needle_length_in: ExtractedField<number | null>;
  unit_markings: ExtractedField;
  manufacturer: ExtractedField;
  batch: ExtractedField;
};

export type SyringeExtractionResult =
  | { ok: true; extraction: SyringeExtraction; modelUsed: string; promptVersionId: string }
  | { ok: false; error: string };

export type NormalisationResult = {
  canonicalName: string;
  drugId: string | null;
};

// ── Defensive JSON parser ──────────────────────────────────────────────────

const VALID_CONFIDENCES = new Set<string>(["high", "medium", "low"]);

function parseConfidence(v: unknown): LlmConfidence {
  if (typeof v === "string" && VALID_CONFIDENCES.has(v)) return v as LlmConfidence;
  return "low"; // default to low if missing or invalid
}

function parseStringField(obj: Record<string, unknown>, key: string): ExtractedField {
  const entry = obj[key];
  if (entry && typeof entry === "object" && "value" in entry) {
    const e = entry as Record<string, unknown>;
    return {
      value: String(e.value ?? ""),
      confidence: parseConfidence(e.confidence),
    };
  }
  // Flat value (no confidence wrapper).
  return { value: String(entry ?? ""), confidence: "low" };
}

function parseNumberField(
  obj: Record<string, unknown>,
  key: string
): ExtractedField<number | null> {
  const entry = obj[key];
  if (entry && typeof entry === "object" && "value" in entry) {
    const e = entry as Record<string, unknown>;
    const n = Number(e.value);
    return {
      value: Number.isFinite(n) ? n : null,
      confidence: parseConfidence(e.confidence),
    };
  }
  const n = Number(entry);
  return { value: Number.isFinite(n) ? n : null, confidence: "low" };
}

/** Parse the `required_components` array defensively → [] on missing/garbage. */
function parseRequiredComponents(
  obj: Record<string, unknown>
): RequiredComponent[] {
  const raw = obj["required_components"];
  if (!Array.isArray(raw)) return [];
  const out: RequiredComponent[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const type = String(r.type ?? "").trim().toLowerCase();
    if (!type) continue;
    out.push({
      type,
      inferred: r.inferred === true,
      confidence: parseConfidence(r.confidence),
    });
  }
  return out;
}

/**
 * Extract the first JSON object from an LLM response, tolerating markdown
 * code fences and surrounding text (PRD §14.6 — caller parses defensively).
 */
export function extractJson(raw: string): Record<string, unknown> | null {
  // Strip markdown fences.
  let text = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");

  // Find first { ... } block.
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    // Not valid JSON.
  }
  return null;
}

export function parseVialExtraction(raw: string): VialExtraction | null {
  const obj = extractJson(raw);
  if (!obj) return null;

  return {
    drug_name_raw: parseStringField(obj, "drug_name_raw"),
    drug_name_canonical: parseStringField(obj, "drug_name_canonical"),
    strength: parseStringField(obj, "strength"),
    concentration_amount: parseNumberField(obj, "concentration_amount"),
    concentration_unit: parseStringField(obj, "concentration_unit"),
    concentration_per_volume: parseNumberField(obj, "concentration_per_volume"),
    volume_ml: parseNumberField(obj, "volume_ml"),
    requires_reconstitution: parseStringField(obj, "requires_reconstitution"),
    diluent_type: parseStringField(obj, "diluent_type"),
    reconstitution_note: parseStringField(obj, "reconstitution_note"),
    required_components: parseRequiredComponents(obj),
    route: parseStringField(obj, "route"),
    directions: parseStringField(obj, "directions"),
    expiry_date: parseStringField(obj, "expiry_date"),
    batch: parseStringField(obj, "batch"),
    manufacturer: parseStringField(obj, "manufacturer"),
  };
}

export function parsePrescriptionExtraction(
  raw: string
): PrescriptionExtraction | null {
  const obj = extractJson(raw);
  if (!obj) return null;

  return {
    drug_name: parseStringField(obj, "drug_name"),
    dose_amount: parseNumberField(obj, "dose_amount"),
    dose_unit: parseStringField(obj, "dose_unit"),
    frequency: parseStringField(obj, "frequency"),
    duration_days: parseNumberField(obj, "duration_days"),
    route: parseStringField(obj, "route"),
    directions: parseStringField(obj, "directions"),
    prescriber: parseStringField(obj, "prescriber"),
    refills: parseNumberField(obj, "refills"),
    diluent_volume_ml: parseNumberField(obj, "diluent_volume_ml"),
    diluent_type: parseStringField(obj, "diluent_type"),
    reconstitution_note: parseStringField(obj, "reconstitution_note"),
    required_components: parseRequiredComponents(obj),
  };
}

function parseSyringeExtraction(raw: string): SyringeExtraction | null {
  const obj = extractJson(raw);
  if (!obj) return null;
  return {
    capacity_ml: parseNumberField(obj, "capacity_ml"),
    needle_gauge: parseNumberField(obj, "needle_gauge"),
    needle_length_in: parseNumberField(obj, "needle_length_in"),
    unit_markings: parseStringField(obj, "unit_markings"),
    manufacturer: parseStringField(obj, "manufacturer"),
    batch: parseStringField(obj, "batch"),
  };
}

/**
 * Run the extract_syringe prompt against a syringe packaging photo. Updates the
 * document status + extracted_json. Never writes to inventory (caller confirms).
 */
export async function extractSyringe(
  documentId: string,
  images: string | string[],
  knownSyringeTypes: string
): Promise<SyringeExtractionResult> {
  const admin = createAdminClient();
  await admin.from("documents").update({ status: "processing" }).eq("id", documentId);

  const result = await llmCall(
    "extract_syringe",
    { syringe_reference_types: knownSyringeTypes },
    { images: Array.isArray(images) ? images : [images] }
  );

  if (!result.ok) {
    await admin.from("documents").update({ status: "failed" }).eq("id", documentId);
    return { ok: false, error: result.error };
  }

  const extraction = parseSyringeExtraction(result.text);
  if (!extraction) {
    logWarn("extraction", "Syringe response was unparseable", {
      documentId,
      modelUsed: result.modelUsed,
      responseChars: result.text.length,
    });
    await admin.from("documents").update({ status: "failed" }).eq("id", documentId);
    return { ok: false, error: "Could not parse the extraction response." };
  }

  await admin
    .from("documents")
    .update({ extracted_json: extraction, status: "extracted" })
    .eq("id", documentId);

  const { data: prompt } = await admin
    .from("prompts")
    .select("current_version_id")
    .eq("slug", "extract_syringe")
    .single();

  return {
    ok: true,
    extraction,
    modelUsed: result.modelUsed,
    promptVersionId: (prompt?.current_version_id as string) ?? "",
  };
}

// ── extractVial ────────────────────────────────────────────────────────────

/**
 * Run the extract_vial prompt against a vial/packaging photo.
 * Updates documents.extracted_json and documents.status.
 * Returns the parsed extraction or an error — never writes to medication
 * tables (the caller must confirm first).
 */
export async function extractVial(
  documentId: string,
  images: string | string[],
  patientMedications: string,
  defaultUnits: string
): Promise<ExtractionResult> {
  const admin = createAdminClient();

  // Mark document as processing.
  await admin
    .from("documents")
    .update({ status: "processing" })
    .eq("id", documentId);

  // Multiple photos (e.g. different sides of a curved vial) are read together.
  const result = await llmCall(
    "extract_vial",
    {
      known_medications: patientMedications,
      user_default_units: defaultUnits,
    },
    { images: Array.isArray(images) ? images : [images] }
  );

  if (!result.ok) {
    await admin
      .from("documents")
      .update({ status: "failed" })
      .eq("id", documentId);
    return { ok: false, error: result.error };
  }

  // Check for document type mismatch (e.g. prescription sent as vial photo).
  const rawObjVial = extractJson(result.text);
  if (rawObjVial && rawObjVial.document_type_mismatch === true) {
    const message = String(
      rawObjVial.message ??
        "This looks like a prescription, not a vial or package label. Try selecting 'Prescription' instead."
    );
    await admin
      .from("documents")
      .update({ status: "failed" })
      .eq("id", documentId);
    return { ok: false, error: message, typeMismatch: true };
  }

  const extraction = parseVialExtraction(result.text);
  if (!extraction) {
    // The model replied but we could not extract a JSON object. Log the length
    // (never the content — it may echo label text / drug names) for diagnosis.
    logWarn("extraction", "Vial response was unparseable", {
      documentId,
      modelUsed: result.modelUsed,
      responseChars: result.text.length,
    });
    await admin
      .from("documents")
      .update({ status: "failed" })
      .eq("id", documentId);
    return { ok: false, error: "Could not parse the extraction response." };
  }

  // Store extracted JSON and mark as extracted.
  await admin
    .from("documents")
    .update({
      extracted_json: extraction,
      status: "extracted",
    })
    .eq("id", documentId);

  // Look up the prompt version ID for delta logging.
  const { data: prompt } = await admin
    .from("prompts")
    .select("current_version_id")
    .eq("slug", "extract_vial")
    .single();

  return {
    ok: true,
    extraction,
    type: "vial",
    modelUsed: result.modelUsed,
    promptVersionId: (prompt?.current_version_id as string) ?? "",
  };
}

// ── extractPrescription ────────────────────────────────────────────────────

/**
 * Run the extract_prescription prompt against a prescription photo or text.
 * Handles both photo (via opts.images) and pasted text (via prescription_text
 * placeholder) cases. Same pattern as extractVial.
 */
export async function extractPrescription(
  documentId: string,
  imageBase64OrText: string | string[],
  patientMedications: string,
  isText: boolean = false
): Promise<ExtractionResult> {
  const admin = createAdminClient();

  await admin
    .from("documents")
    .update({ status: "processing" })
    .eq("id", documentId);

  const textValue = typeof imageBase64OrText === "string" ? imageBase64OrText : "";
  const vars: Record<string, string> = {
    known_medications: patientMedications,
    prescription_text: isText ? textValue : "(see attached)",
  };

  const images = Array.isArray(imageBase64OrText)
    ? imageBase64OrText
    : [imageBase64OrText];
  const result = await llmCall(
    "extract_prescription",
    vars,
    isText ? undefined : { images }
  );

  if (!result.ok) {
    await admin
      .from("documents")
      .update({ status: "failed" })
      .eq("id", documentId);
    return { ok: false, error: result.error };
  }

  // Check for document type mismatch (e.g. vial photo sent as prescription).
  const rawObj = extractJson(result.text);
  if (rawObj && rawObj.document_type_mismatch === true) {
    const message = String(
      rawObj.message ??
        "This looks like a medication label, not a prescription. It shows the concentration and packaging details, but not a specific dosage prescribed for you. Try selecting 'Vial / package' instead."
    );
    await admin
      .from("documents")
      .update({ status: "failed" })
      .eq("id", documentId);
    return { ok: false, error: message, typeMismatch: true };
  }

  const extraction = parsePrescriptionExtraction(result.text);
  if (!extraction) {
    logWarn("extraction", "Prescription response was unparseable", {
      documentId,
      modelUsed: result.modelUsed,
      responseChars: result.text.length,
    });
    await admin
      .from("documents")
      .update({ status: "failed" })
      .eq("id", documentId);
    return { ok: false, error: "Could not parse the prescription extraction." };
  }

  await admin
    .from("documents")
    .update({
      extracted_json: extraction,
      status: "extracted",
    })
    .eq("id", documentId);

  const { data: prompt } = await admin
    .from("prompts")
    .select("current_version_id")
    .eq("slug", "extract_prescription")
    .single();

  return {
    ok: true,
    extraction,
    type: "prescription",
    modelUsed: result.modelUsed,
    promptVersionId: (prompt?.current_version_id as string) ?? "",
  };
}

// ── normaliseDrugName ──────────────────────────────────────────────────────

/**
 * Map a raw drug name (from OCR / user input) to a canonical drugs record
 * via the normalise_drug_name prompt (PRD §14.8). Returns the canonical name
 * and, if matched, the drug ID from the reference catalogue.
 */
export async function normaliseDrugName(
  rawName: string,
  knownDrugs: string,
  locale: string = "en-GB"
): Promise<NormalisationResult | null> {
  const result = await llmCall("normalise_drug_name", {
    raw_name: rawName,
    known_drugs: knownDrugs,
    user_locale: locale,
  });

  if (!result.ok) return null;

  const obj = extractJson(result.text);
  if (!obj) return null;

  const canonicalName = String(obj.canonical_name ?? obj.canonicalName ?? rawName);

  // Try to match the canonical name against the drugs table.
  const admin = createAdminClient();
  const { data: drug } = await admin
    .from("drugs")
    .select("id")
    .ilike("canonical_name", canonicalName)
    .maybeSingle();

  return {
    canonicalName,
    drugId: (drug?.id as string) ?? null,
  };
}

// ── writeExtractionDeltas ──────────────────────────────────────────────────

/**
 * Write one extraction_deltas row per field where the LLM value differs from
 * the user-confirmed value (PRD §5.2.3). No patient_id, no medication_id
 * (hard rule #10). Called after the user confirms the extraction.
 *
 * Works with both VialExtraction and PrescriptionExtraction — the extraction
 * param is a generic record of ExtractedField values keyed by field name.
 */
export async function writeExtractionDeltas(opts: {
  documentId: string | null;
  drugCanonicalName: string;
  // Accepts a whole VialExtraction / PrescriptionExtraction; non-{value,confidence}
  // members (e.g. required_components[]) are skipped by the guard below.
  extraction: Record<string, unknown>;
  userValues: Record<string, string>;
  direction: "llm_to_user" | "user_to_llm";
  promptSlug: string;
  promptVersionId: string;
  modelUsed: string;
}): Promise<void> {
  const admin = createAdminClient();

  const rows = [];
  for (const [key, raw] of Object.entries(opts.extraction)) {
    // Skip non-{value,confidence} fields (e.g. the required_components array),
    // which aren't per-field deltas (hard rule #10 stays — no identifiers).
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("value" in raw)) {
      continue;
    }
    const field = raw as ExtractedField<unknown>;
    const llmValue = String(field.value ?? "");
    const userValue = opts.userValues[key] ?? "";

    if (llmValue !== userValue) {
      rows.push({
        document_id: opts.documentId,
        drug_canonical_name: opts.drugCanonicalName,
        prompt_slug: opts.promptSlug,
        prompt_version_id: opts.promptVersionId,
        model_used: opts.modelUsed,
        field_name: key,
        direction: opts.direction,
        llm_value: llmValue,
        user_value: userValue,
        llm_confidence: field.confidence,
      });
    }
  }

  if (rows.length > 0) {
    await admin.from("extraction_deltas").insert(rows);
  }
}

// ── Per-user correction signal (§5.2.3) ────────────────────────────────────

/**
 * Record per-user extraction corrections. When a user repeatedly edits the
 * same field for the same drug, the correction count grows, improving future
 * extractions for that user. Patient-scoped — does not flow into the
 * system-wide extraction_deltas table.
 */
export async function writeUserCorrections(opts: {
  patientId: string;
  drugCanonicalName: string;
  corrections: Record<string, string>; // field_name → corrected_to
}): Promise<void> {
  const admin = createAdminClient();

  for (const [fieldName, correctedTo] of Object.entries(opts.corrections)) {
    if (!correctedTo) continue;

    // Upsert: increment correction_count if the same field+drug already exists.
    const { data: existing } = await admin
      .from("user_extraction_corrections")
      .select("id, correction_count")
      .eq("patient_id", opts.patientId)
      .eq("drug_canonical_name", opts.drugCanonicalName)
      .eq("field_name", fieldName)
      .maybeSingle();

    if (existing) {
      await admin
        .from("user_extraction_corrections")
        .update({
          corrected_to: correctedTo,
          correction_count: (existing.correction_count as number) + 1,
        })
        .eq("id", existing.id);
    } else {
      await admin.from("user_extraction_corrections").insert({
        patient_id: opts.patientId,
        drug_canonical_name: opts.drugCanonicalName,
        field_name: fieldName,
        corrected_to: correctedTo,
      });
    }
  }
}
