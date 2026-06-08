import "server-only";
import { encrypt, decrypt } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

// Read/write helpers for system_secrets (PRD §14.3, §14.9).
// Uses the service-role client — system_secrets has no RLS policies.

/** Generate a masked preview: first 6 + "..." + last 4 chars. */
function mask(value: string): string {
  if (value.length < 10) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

/**
 * Resolve the OpenRouter API key. For a hosted deployment (e.g. Vercel) the key
 * is set as an environment variable — the durable source of truth that survives
 * every deploy and needs no encrypt/decrypt round-trip. The encrypted
 * `system_secrets` row (the /admin field) remains a fallback for setups that
 * prefer DB-managed secrets. Env wins so a stale or undecryptable DB row can
 * never strand the app (PRD §14.3; relaxes CLAUDE.md rule #4 for THIS key only).
 *
 * Accepts OPENROUTER_API_KEY (preferred), OPEN_ROUTER, or the local bootstrap
 * OPENROUTER_BOOTSTRAP_KEY, in that order.
 */
export async function getOpenRouterApiKey(): Promise<string> {
  const fromEnv = (
    process.env.OPENROUTER_API_KEY ||
    process.env.OPEN_ROUTER ||
    process.env.OPENROUTER_BOOTSTRAP_KEY ||
    ""
  ).trim();
  if (fromEnv) return fromEnv;
  return readSecret("openrouter_api_key");
}

/** Read and decrypt a system secret by key. Throws if not found. */
export async function readSecret(key: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("system_secrets")
    .select("value_encrypted")
    .eq("key", key)
    .single();

  if (error) {
    // A query error here is a DB / service-role problem, NOT a missing secret —
    // surface it so the two are distinguishable in the log (PRD §14.9).
    throw new Error(`Secret "${key}" lookup failed (database/service-role): ${error.message}`);
  }
  if (!data) {
    throw new Error(`Secret "${key}" not found in system_secrets.`);
  }

  return decrypt(data.value_encrypted, serverEnv().secretEncryptionKey);
}

/** Upsert an encrypted system secret. */
export async function writeSecret(
  key: string,
  value: string,
  description: string,
  userId: string
): Promise<void> {
  const admin = createAdminClient();
  const { secretEncryptionKey } = serverEnv();

  const valueEncrypted = encrypt(value, secretEncryptionKey);
  const valueMasked = mask(value);

  const { error } = await admin.from("system_secrets").upsert(
    {
      key,
      value_encrypted: valueEncrypted,
      value_masked: valueMasked,
      description,
      updated_by: userId,
    },
    { onConflict: "key" }
  );

  if (error) {
    throw new Error(`Failed to write secret "${key}": ${error.message}`);
  }
}
