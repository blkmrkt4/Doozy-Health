import "server-only";
import { readSecret } from "@/lib/secrets";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError, logWarn } from "@/lib/log";
import {
  callOpenRouter,
  type ChatMessage,
  type ContentPart,
} from "@/lib/openrouter";

// Re-export the transport + its types so existing `@/lib/llm` importers keep
// working. callOpenRouter itself now lives in lib/openrouter.ts so it is a real
// module boundary that tests can mock (PRD §15).
export {
  callOpenRouter,
  type ChatMessage,
  type ContentPart,
  type OpenRouterResult,
} from "@/lib/openrouter";

// ── Types ──────────────────────────────────────────────────────────────────

export type LlmCallOpts = {
  /** Base64 data-URL images — sent as multipart content, never via {{placeholder}}. */
  images?: string[];
  /** System message prepended to the conversation. */
  systemMessage?: string;
  /** Extra messages appended after the rendered prompt. */
  extraMessages?: ChatMessage[];
  /** Request timeout in ms (default 30 000). */
  timeoutMs?: number;
  /** Flag admin test calls (written to llm_call_logs). */
  wasTest?: boolean;
  /** Admin user id for test calls. */
  actorId?: string;
};

type AttemptLog = {
  model: string;
  wasFallback: 0 | 1 | 2;
  error: string;
  latencyMs: number;
};

export type LlmCallResult =
  | { ok: true; text: string; modelUsed: string; wasFallback: 0 | 1 | 2 }
  | { ok: false; error: string; attempts: AttemptLog[] };

// Prompt binding shape (matches the prompt_bindings table). Its temperature /
// max_tokens / response_format / json_schema fields satisfy the transport's
// OpenRouterCallConfig structurally, so a full binding can be passed through.
type PromptBinding = {
  primary_model_slug: string;
  fallback_1_model_slug: string | null;
  fallback_2_model_slug: string | null;
  temperature: number;
  max_tokens: number;
  response_format: "text" | "json";
  json_schema: unknown;
};

// ── Template rendering ─────────────────────────────────────────────────────

/** Replace {{key}} placeholders. Missing vars are left intact (PRD §14.6). */
export function renderTemplate(
  body: string,
  vars: Record<string, string>
): string {
  return body.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in vars ? vars[key] : match
  );
}

// ── Build messages ─────────────────────────────────────────────────────────

function buildMessages(
  renderedBody: string,
  opts?: LlmCallOpts
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (opts?.systemMessage) {
    messages.push({ role: "system", content: opts.systemMessage });
  }

  // User message — if images are attached, use multipart content array.
  if (opts?.images && opts.images.length > 0) {
    const parts: ContentPart[] = [{ type: "text", text: renderedBody }];
    for (const dataUrl of opts.images) {
      parts.push({ type: "image_url", image_url: { url: dataUrl } });
    }
    messages.push({ role: "user", content: parts });
  } else {
    messages.push({ role: "user", content: renderedBody });
  }

  if (opts?.extraMessages) {
    messages.push(...opts.extraMessages);
  }

  return messages;
}

// ── Log helper ─────────────────────────────────────────────────────────────

async function logAttempt(
  admin: ReturnType<typeof createAdminClient>,
  entry: {
    promptSlug: string;
    model: string;
    wasFallback: 0 | 1 | 2;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    success: boolean;
    errorMessage: string | null;
    wasTest: boolean;
    actorId: string | null;
  }
): Promise<void> {
  await admin.from("llm_call_logs").insert({
    prompt_slug: entry.promptSlug,
    model_used: entry.model,
    was_fallback: entry.wasFallback,
    latency_ms: entry.latencyMs,
    input_tokens: entry.inputTokens,
    output_tokens: entry.outputTokens,
    cost_usd: null, // computed in a follow-up (§14.3)
    success: entry.success,
    error_message: entry.errorMessage,
    was_test: entry.wasTest,
    actor_id: entry.actorId ?? null,
  });
}

// ── llmCall — the public API (PRD §14.6) ───────────────────────────────────

/**
 * The only path from app code to an LLM. Loads the prompt by slug, renders
 * the template, tries the primary model then up to 2 fallbacks, and logs
 * every attempt to llm_call_logs.
 */
export async function llmCall(
  promptSlug: string,
  vars: Record<string, string>,
  opts?: LlmCallOpts
): Promise<LlmCallResult> {
  const admin = createAdminClient();

  // 1. Load prompt (must be active with a current version).
  // maybeSingle so "no such prompt" returns null (not a PGRST116 error) — that
  // way promptErr means a real DB / service-role failure, distinct from a
  // genuinely missing prompt.
  const { data: prompt, error: promptErr } = await admin
    .from("prompts")
    .select("id, current_version_id, status")
    .eq("slug", promptSlug)
    .maybeSingle();

  if (promptErr || !prompt) {
    // A query error here means we could NOT reach the prompts table with the
    // service-role client (bad SUPABASE_SERVICE_ROLE_KEY, network, RLS-on-an-
    // admin-table) — a different failure from a genuinely missing prompt. Make
    // the distinction loud so it is diagnosable (slug + db error only).
    if (promptErr) {
      logError("llm", "Could not load prompt — database / service-role error", promptErr, {
        promptSlug,
        hint: "check SUPABASE_SERVICE_ROLE_KEY; the admin client bypasses RLS",
      });
      return {
        ok: false,
        error: `Prompt "${promptSlug}" could not be loaded (database): ${promptErr.message}`,
        attempts: [],
      };
    }
    logWarn("llm", "Prompt not found", { promptSlug });
    return { ok: false, error: `Prompt "${promptSlug}" not found.`, attempts: [] };
  }
  if (prompt.status !== "active") {
    logWarn("llm", "Prompt is disabled — enable it in /admin/prompts", {
      promptSlug,
      status: prompt.status,
    });
    return {
      ok: false,
      error: `Prompt "${promptSlug}" is disabled.`,
      attempts: [],
    };
  }
  if (!prompt.current_version_id) {
    logWarn("llm", "Prompt has no current version", { promptSlug });
    return {
      ok: false,
      error: `Prompt "${promptSlug}" has no current version.`,
      attempts: [],
    };
  }

  // 2. Load version body.
  const { data: version, error: versionErr } = await admin
    .from("prompt_versions")
    .select("body")
    .eq("id", prompt.current_version_id)
    .single();

  if (!version) {
    logWarn("llm", "Prompt version row not found", {
      promptSlug,
      versionId: prompt.current_version_id,
      dbError: versionErr?.message ?? null,
    });
    return {
      ok: false,
      error: `Version for "${promptSlug}" not found.`,
      attempts: [],
    };
  }

  // 3. Load binding.
  const { data: bindingRow, error: bindingErr } = await admin
    .from("prompt_bindings")
    .select(
      "primary_model_slug, fallback_1_model_slug, fallback_2_model_slug, " +
        "temperature, max_tokens, response_format, json_schema"
    )
    .eq("prompt_id", prompt.id)
    .single();

  if (!bindingRow) {
    logWarn("llm", "Prompt binding not found — no model bound", {
      promptSlug,
      dbError: bindingErr?.message ?? null,
    });
    return {
      ok: false,
      error: `Binding for "${promptSlug}" not found.`,
      attempts: [],
    };
  }

  const binding = bindingRow as unknown as PromptBinding;

  // 4. Render template + build messages.
  const rendered = renderTemplate(version.body, vars);
  const messages = buildMessages(rendered, opts);

  // 5. Read the OpenRouter API key.
  let apiKey: string;
  try {
    apiKey = await readSecret("openrouter_api_key");
  } catch (err) {
    // The single most common silent failure: no key in system_secrets. Make it
    // loud in the server log (slug only — never the vars/images, which carry
    // health data) so it is diagnosable instead of a blank screen.
    logError("llm", "OpenRouter API key not configured in system_secrets", err, {
      promptSlug,
      hint: "seed it via: OPENROUTER_BOOTSTRAP_KEY=... npm run seed:key",
    });
    return {
      ok: false,
      error: "OpenRouter API key not configured.",
      attempts: [],
    };
  }

  // 6. Try primary → fallback 1 → fallback 2.
  const chain: string[] = [
    binding.primary_model_slug,
    binding.fallback_1_model_slug,
    binding.fallback_2_model_slug,
  ].filter((s): s is string => Boolean(s));

  const attempts: AttemptLog[] = [];

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const wasFallback = i as 0 | 1 | 2;
    const start = Date.now();

    try {
      const result = await callOpenRouter(
        apiKey,
        model,
        messages,
        binding,
        { timeoutMs: opts?.timeoutMs }
      );

      const latencyMs = Date.now() - start;

      await logAttempt(admin, {
        promptSlug,
        model,
        wasFallback,
        latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        success: true,
        errorMessage: null,
        wasTest: opts?.wasTest ?? false,
        actorId: opts?.actorId ?? null,
      });

      return { ok: true, text: result.text, modelUsed: model, wasFallback };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";

      attempts.push({ model, wasFallback, error: errorMessage, latencyMs });

      await logAttempt(admin, {
        promptSlug,
        model,
        wasFallback,
        latencyMs,
        inputTokens: null,
        outputTokens: null,
        success: false,
        errorMessage,
        wasTest: opts?.wasTest ?? false,
        actorId: opts?.actorId ?? null,
      });
    }
  }

  // Every model in the chain failed. Log the chain + per-model causes (model
  // slugs and error strings only — no vars/images) so the terminal shows why.
  logWarn("llm", "All models in the fallback chain failed", {
    promptSlug,
    modelsTried: attempts.map((a) => a.model).join(" → "),
    lastError: attempts[attempts.length - 1]?.error ?? "unknown",
  });

  return { ok: false, error: "All models failed.", attempts };
}
