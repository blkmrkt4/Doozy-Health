import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, appendFileSync, existsSync } from "node:fs";

// Reconcile the OpenRouter key between its two homes so it can't be lost:
//   - system_secrets (the encrypted row the running app reads — runtime source)
//   - .env.local      (OPENROUTER_BOOTSTRAP_KEY — the durable bootstrap copy)
//
//   npm run sync:key
//
// Behaviour:
//   • in DB, not in .env  → write OPENROUTER_BOOTSTRAP_KEY to .env.local
//   • in .env, not in DB  → seed system_secrets from the env value
//   • both, equal         → report in-sync, do nothing
//   • both, differ        → warn and leave BOTH untouched (don't guess a winner)
//   • neither             → explain how to add one
//
// Like the other scripts, we don't import lib/crypto.ts / lib/secrets.ts (they
// carry `import "server-only"`); we inline the identical AES-256-GCM envelope.

const ENV_PATH = ".env.local";
const ENV_VAR = "OPENROUTER_BOOTSTRAP_KEY";
const SECRET_KEY = "openrouter_api_key";
const ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12;

config({ path: ENV_PATH });

function assertKey(keyHex: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error("SECRET_ENCRYPTION_KEY must be 64 hex characters (32 bytes).");
  }
  return Buffer.from(keyHex, "hex");
}

function encrypt(plaintext: string, keyHex: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, assertKey(keyHex), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

function decrypt(envelope: string, keyHex: string): string {
  const [ivHex, tagHex, dataHex] = envelope.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid envelope — expected iv:tag:ciphertext.");
  }
  const decipher = createDecipheriv(ALGORITHM, assertKey(keyHex), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

function mask(value: string): string {
  if (value.length < 10) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

/** True if .env.local already declares the var (even empty) — avoids duplicates. */
function envFileDeclaresVar(): boolean {
  if (!existsSync(ENV_PATH)) return false;
  return new RegExp(`^${ENV_VAR}=`, "m").test(readFileSync(ENV_PATH, "utf8"));
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const encryptionKey = process.env.SECRET_ENCRYPTION_KEY;
  if (!url || !serviceRoleKey || !encryptionKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or " +
        "SECRET_ENCRYPTION_KEY (check .env.local)."
    );
    process.exit(1);
  }

  // A blank/missing value both count as "not in env".
  const envKey = (process.env.OPENROUTER_BOOTSTRAP_KEY ?? "").trim() || null;

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase
    .from("system_secrets")
    .select("value_encrypted")
    .eq("key", SECRET_KEY)
    .maybeSingle();
  if (error) {
    console.error(`Could not read system_secrets: ${error.message}`);
    process.exit(1);
  }
  const dbKey = data?.value_encrypted
    ? decrypt(data.value_encrypted as string, encryptionKey)
    : null;

  // ── DB → .env.local (the main case you asked for) ──────────────────────────
  if (dbKey && !envKey) {
    if (envFileDeclaresVar()) {
      console.warn(
        `${ENV_VAR} is already declared (but empty) in ${ENV_PATH}. ` +
          `Set its value manually to ${mask(dbKey)} — not overwriting.`
      );
      return;
    }
    appendFileSync(
      ENV_PATH,
      `\n# OpenRouter bootstrap key — mirrors system_secrets so the key survives\n` +
        `# a DB reset / new machine. The running app reads the DB, not this.\n` +
        `${ENV_VAR}=${dbKey}\n`
    );
    console.log(`✓ Wrote ${ENV_VAR} to ${ENV_PATH} from the database (${mask(dbKey)}).`);
    return;
  }

  // ── .env.local → DB ────────────────────────────────────────────────────────
  if (envKey && !dbKey) {
    const { error: upErr } = await supabase.from("system_secrets").upsert(
      {
        key: SECRET_KEY,
        value_encrypted: encrypt(envKey, encryptionKey),
        value_masked: mask(envKey),
        description: "OpenRouter API key (synced from .env.local bootstrap).",
      },
      { onConflict: "key" }
    );
    if (upErr) {
      console.error(`Could not seed system_secrets: ${upErr.message}`);
      process.exit(1);
    }
    console.log(`✓ Seeded system_secrets from ${ENV_VAR} (${mask(envKey)}).`);
    return;
  }

  // ── Both present ───────────────────────────────────────────────────────────
  if (envKey && dbKey) {
    if (envKey === dbKey) {
      console.log(`✓ In sync — ${ENV_VAR} and system_secrets match (${mask(dbKey)}).`);
    } else {
      console.warn(
        `⚠ ${ENV_VAR} (${mask(envKey)}) and system_secrets (${mask(dbKey)}) DIFFER. ` +
          `Left both untouched — reconcile manually so the right one wins.`
      );
    }
    return;
  }

  // ── Neither ────────────────────────────────────────────────────────────────
  console.error(
    `No OpenRouter key found in either place. Add ${ENV_VAR}=sk-or-... to ` +
      `${ENV_PATH} (or save it in /admin), then re-run.`
  );
  process.exit(1);
}

main();
