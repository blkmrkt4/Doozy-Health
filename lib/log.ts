import "server-only";

// Structured server-side diagnostic log. Two hard constraints:
//
//   1. Server console only — this NEVER reaches the user. User-facing failure
//      copy is produced separately and must not reference models, prompts,
//      OpenRouter, or costs (CLAUDE.md regulatory line / LLM rules).
//   2. NEVER pass health values (hard rule #12): no drug names, doses, dose
//      times, or photo contents. `meta` is for safe diagnostics only — ids,
//      error categories, prompt/model slugs, counts, latencies, booleans.
//
// The point is to make failures visible in the terminal instead of vanishing.

export type LogScope =
  | "llm"
  | "extraction"
  | "upload"
  | "auth"
  | "reminders"
  | "sms"
  | "push"
  | "drug-reference";

type LogMeta = Record<string, string | number | boolean | null | undefined>;

function emit(
  level: "warn" | "error",
  scope: LogScope,
  message: string,
  meta?: LogMeta
): void {
  const line = {
    at: new Date().toISOString(),
    level,
    scope,
    message,
    ...(meta ?? {}),
  };
  // Single structured line — greppable by scope, parseable as JSON.
  // eslint-disable-next-line no-console
  (level === "error" ? console.error : console.warn)(
    `[doozy:${scope}] ${message}`,
    JSON.stringify(line)
  );
}

/** A failure we recovered from (returned an error to the caller). */
export function logWarn(scope: LogScope, message: string, meta?: LogMeta): void {
  emit("warn", scope, message, meta);
}

/** A failure, optionally with the underlying Error's message (never health data). */
export function logError(
  scope: LogScope,
  message: string,
  err?: unknown,
  meta?: LogMeta
): void {
  const cause =
    err instanceof Error ? err.message : err != null ? String(err) : undefined;
  emit("error", scope, message, { ...(meta ?? {}), cause });
}
