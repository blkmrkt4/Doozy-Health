import "server-only";
import { llmCall } from "@/lib/llm";
import { createAdminClient } from "@/lib/supabase/admin";
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

export type VialExtraction = {
  drug_name_raw: ExtractedField;
  drug_name_canonical: ExtractedField;
  strength: ExtractedField;
  concentration_amount: ExtractedField<number | null>;
  concentration_unit: ExtractedField;
  concentration_per_volume: ExtractedField<number | null>;
  volume_ml: ExtractedField<number | null>;
  route: ExtractedField;
  expiry_date: ExtractedField;
  batch: ExtractedField;
  manufacturer: ExtractedField;
};

export type ExtractionResult =
  | { ok: true; extraction: VialExtraction; modelUsed: string; promptVersionId: string }
  | { ok: false; error: string };

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

/**
 * Extract the first JSON object from an LLM response, tolerating markdown
 * code fences and surrounding text (PRD §14.6 — caller parses defensively).
 */
function extractJson(raw: string): Record<string, unknown> | null {
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

function parseVialExtraction(raw: string): VialExtraction | null {
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
    route: parseStringField(obj, "route"),
    expiry_date: parseStringField(obj, "expiry_date"),
    batch: parseStringField(obj, "batch"),
    manufacturer: parseStringField(obj, "manufacturer"),
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
  imageBase64: string,
  patientMedications: string,
  defaultUnits: string
): Promise<ExtractionResult> {
  const admin = createAdminClient();

  // Mark document as processing.
  await admin
    .from("documents")
    .update({ status: "processing" })
    .eq("id", documentId);

  const result = await llmCall(
    "extract_vial",
    {
      known_medications: patientMedications,
      user_default_units: defaultUnits,
    },
    { images: [imageBase64] }
  );

  if (!result.ok) {
    await admin
      .from("documents")
      .update({ status: "failed" })
      .eq("id", documentId);
    return { ok: false, error: result.error };
  }

  const extraction = parseVialExtraction(result.text);
  if (!extraction) {
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
    modelUsed: result.modelUsed,
    promptVersionId: (prompt?.current_version_id as string) ?? "",
  };
}

// ── writeExtractionDeltas ──────────────────────────────────────────────────

/**
 * Write one extraction_deltas row per field where the LLM value differs from
 * the user-confirmed value (PRD §5.2.3). No patient_id, no medication_id
 * (hard rule #10). Called after the user confirms the extraction.
 */
export async function writeExtractionDeltas(opts: {
  documentId: string | null;
  drugCanonicalName: string;
  extraction: VialExtraction;
  userValues: Record<string, string>;
  direction: "llm_to_user" | "user_to_llm";
  promptSlug: string;
  promptVersionId: string;
  modelUsed: string;
}): Promise<void> {
  const admin = createAdminClient();

  // Compare each extracted field with the user-confirmed value.
  const fields: { key: keyof VialExtraction; userKey: string }[] = [
    { key: "drug_name_raw", userKey: "drug_name_raw" },
    { key: "drug_name_canonical", userKey: "drug_name_canonical" },
    { key: "strength", userKey: "strength" },
    { key: "concentration_amount", userKey: "concentration_amount" },
    { key: "concentration_unit", userKey: "concentration_unit" },
    { key: "concentration_per_volume", userKey: "concentration_per_volume" },
    { key: "volume_ml", userKey: "volume_ml" },
    { key: "route", userKey: "route" },
    { key: "expiry_date", userKey: "expiry_date" },
    { key: "batch", userKey: "batch" },
    { key: "manufacturer", userKey: "manufacturer" },
  ];

  const rows = [];
  for (const { key, userKey } of fields) {
    const field = opts.extraction[key];
    const llmValue = String(field.value ?? "");
    const userValue = opts.userValues[userKey] ?? "";

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
