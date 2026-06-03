import "server-only";

// Low-level OpenRouter HTTP transport. This lives in its own module on purpose:
// it is THE mock boundary for tests (PRD §15 — never call live OpenRouter in a
// test). Because llmCall imports callOpenRouter across this module boundary,
// vi.spyOn(openrouterModule, "callOpenRouter") actually intercepts the call —
// a same-module spy cannot (the internal binding bypasses the export).
//
// App code must never import this directly — go through llmCall.

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string | ContentPart[];
};

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type OpenRouterResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

// Just the binding fields the HTTP call consumes (a structural subset of
// PromptBinding, so callers can pass a full binding).
export type OpenRouterCallConfig = {
  temperature: number;
  max_tokens: number;
  response_format: "text" | "json";
  json_schema: unknown;
};

/**
 * Low-level HTTP call to OpenRouter /api/v1/chat/completions.
 * Exported so tests can mock at this boundary. App code should never call
 * this directly — use llmCall instead.
 */
export async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  binding: OpenRouterCallConfig,
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
