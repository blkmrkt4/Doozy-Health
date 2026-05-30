import "server-only";
import { readSecret } from "@/lib/secrets";
import { createAdminClient } from "@/lib/supabase/admin";

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

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string | ContentPart[];
};

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type AttemptLog = {
  model: string;
  wasFallback: 0 | 1 | 2;
  error: string;
  latencyMs: number;
};

export type LlmCallResult =
  | { ok: true; text: string; modelUsed: string; wasFallback: 0 | 1 | 2 }
  | { ok: false; error: string; attempts: AttemptLog[] };

export type OpenRouterResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

// Prompt binding shape (matches the prompt_bindings table).
type PromptBinding = {
  primary_model_slug: string;
  fallback_1_model_slug: string | null;
  fallback_2_model_slug: string | null;
  temperature: number;
  max_tokens: number;
  response_format: "text" | "json";
  json_schema: unknown;
};

// ── callOpenRouter (the mock boundary for tests — PRD §15) ─────────────────

/**
 * Low-level HTTP call to OpenRouter /api/v1/chat/completions.
 * Exported so tests can mock at this boundary. App code should never call
 * this directly — use llmCall instead.
 */
export async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  binding: Pick<PromptBinding, "temperature" | "max_tokens" | "response_format" | "json_schema">,
  opts?: { timeoutMs?: number }
): Promise<OpenRouterResult> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: Number(binding.temperature),
    max_tokens: binding.max_tokens,
  };

  if (binding.response_format === "json") {
    body.response_format = { type: "json_object" };
    if (binding.json_schema) {
      body.response_format = {
        type: "json_schema",
        json_schema: binding.json_schema,
      };
    }
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://doozy.health",
      "X-Title": "Doozy Health",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(unreadable)");
    throw new Error(`OpenRouter ${res.status}: ${text}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };

  if (json.error?.message) {
    throw new Error(`OpenRouter error: ${json.error.message}`);
  }

  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text) {
    throw new Error("OpenRouter returned an empty response.");
  }

  return {
    text,
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
  };
}

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
  const { data: prompt, error: promptErr } = await admin
    .from("prompts")
    .select("id, current_version_id, status")
    .eq("slug", promptSlug)
    .single();

  if (promptErr || !prompt) {
    return { ok: false, error: `Prompt "${promptSlug}" not found.`, attempts: [] };
  }
  if (prompt.status !== "active") {
    return {
      ok: false,
      error: `Prompt "${promptSlug}" is disabled.`,
      attempts: [],
    };
  }
  if (!prompt.current_version_id) {
    return {
      ok: false,
      error: `Prompt "${promptSlug}" has no current version.`,
      attempts: [],
    };
  }

  // 2. Load version body.
  const { data: version } = await admin
    .from("prompt_versions")
    .select("body")
    .eq("id", prompt.current_version_id)
    .single();

  if (!version) {
    return {
      ok: false,
      error: `Version for "${promptSlug}" not found.`,
      attempts: [],
    };
  }

  // 3. Load binding.
  const { data: bindingRow } = await admin
    .from("prompt_bindings")
    .select(
      "primary_model_slug, fallback_1_model_slug, fallback_2_model_slug, " +
        "temperature, max_tokens, response_format, json_schema"
    )
    .eq("prompt_id", prompt.id)
    .single();

  if (!bindingRow) {
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
  } catch {
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

  return { ok: false, error: "All models failed.", attempts };
}
