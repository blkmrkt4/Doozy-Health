import type { SupabaseClient } from "@supabase/supabase-js";

// OpenRouter model catalogue sync (PRD §14.3, §14.5). Idempotent: upserts
// the full catalogue and marks models that have disappeared as unavailable.
//
// The fetch function is injected so tests can stub it (no live external calls
// in tests — PRD §15). The service-role client is required: openrouter_models
// has no client write policy.

export type ModelSyncResult = {
  total: number;
  upserted: number;
  deactivated: number;
};

// Shape of a single model from the OpenRouter /api/v1/models response.
type OpenRouterModelData = {
  id: string;
  name: string;
  context_length?: number;
  pricing?: {
    prompt?: string;  // cost per token as string
    completion?: string;
  };
  architecture?: {
    modality?: string;
    tokenizer?: string;
  };
  top_provider?: {
    is_moderated?: boolean;
  };
  per_request_limits?: unknown;
};

/** Convert per-token cost (string) to per-million-token cost (number). */
function perMillion(perToken: string | undefined): number | null {
  if (!perToken) return null;
  const n = Number(perToken);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 1_000_000 * 10_000) / 10_000; // numeric(12,4)
}

/** Derive capability booleans from model name/id heuristics. */
function deriveCapabilities(m: OpenRouterModelData) {
  const id = m.id.toLowerCase();
  const name = (m.name ?? "").toLowerCase();
  const modality = m.architecture?.modality ?? "";

  return {
    supports_vision: modality.includes("image") || /vision|4o|gemini|claude/.test(id),
    supports_tools: /gpt-4|claude|gemini/.test(id),
    supports_json_mode: /gpt-4|claude|gemini/.test(id),
    is_coding_specialist: /code|codex|deepseek-coder|starcoder/.test(id),
    is_reasoning_specialist: /o1|o3|reasoning|r1/.test(name) || /o1|o3/.test(id),
  };
}

export async function syncModels(
  admin: SupabaseClient,
  fetchFn: typeof fetch = fetch
): Promise<ModelSyncResult> {
  const res = await fetchFn("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(
      `OpenRouter /models returned ${res.status}: ${await res.text()}`
    );
  }

  const json = (await res.json()) as { data?: OpenRouterModelData[] };
  const models = json.data;
  if (!Array.isArray(models)) {
    throw new Error("Unexpected OpenRouter /models response shape.");
  }

  const now = new Date().toISOString();
  const slugsSeen = new Set<string>();
  let upserted = 0;

  for (const m of models) {
    if (!m.id) continue;
    slugsSeen.add(m.id);

    const provider = m.id.split("/")[0] ?? "unknown";
    const caps = deriveCapabilities(m);

    const { error } = await admin.from("openrouter_models").upsert(
      {
        slug: m.id,
        name: m.name ?? m.id,
        provider,
        context_length: m.context_length ?? null,
        input_cost_per_mtoken: perMillion(m.pricing?.prompt),
        output_cost_per_mtoken: perMillion(m.pricing?.completion),
        ...caps,
        is_available: true,
        last_synced_at: now,
        raw: m,
      },
      { onConflict: "slug" }
    );
    if (error) {
      throw new Error(`upsert model ${m.id}: ${error.message}`);
    }
    upserted++;
  }

  // Mark models not in the response as unavailable (soft-delete).
  let deactivated = 0;
  if (slugsSeen.size > 0) {
    const { data: existing } = await admin
      .from("openrouter_models")
      .select("slug")
      .eq("is_available", true);

    const toDeactivate = (existing ?? [])
      .map((r) => r.slug as string)
      .filter((s) => !slugsSeen.has(s));

    if (toDeactivate.length > 0) {
      const { error } = await admin
        .from("openrouter_models")
        .update({ is_available: false, last_synced_at: now })
        .in("slug", toDeactivate);
      if (error) {
        throw new Error(`deactivate models: ${error.message}`);
      }
      deactivated = toDeactivate.length;
    }
  }

  return { total: models.length, upserted, deactivated };
}
