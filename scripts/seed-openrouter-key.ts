import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createCipheriv, randomBytes } from "node:crypto";

// Dev-only seeding of the OpenRouter API key into system_secrets (PRD §14.3).
// The running app reads keys from system_secrets, never the env (hard rule #4);
// this script is the local bootstrap that puts the key there. Run with:
//
//   OPENROUTER_BOOTSTRAP_KEY=sk-or-... npm run seed:key
//
// We deliberately do NOT import lib/crypto.ts or lib/secrets.ts here: both carry
// `import "server-only"`, which throws outside the Next bundle. Instead we inline
// the identical AES-256-GCM envelope (iv:tag:ciphertext, all hex) so the app's
// decrypt() reads it back exactly. ES imports are hoisted, so dotenv runs after
// them — fine, since no imported module reads process.env at import time.

config({ path: ".env.local" });

const ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12; // 96-bit IV, GCM standard
const SECRET_KEY = "openrouter_api_key" as const;

/** Mirror of lib/crypto.ts encrypt — envelope "iv:tag:ciphertext" (all hex). */
function encrypt(plaintext: string, keyHex: string): string {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)."
    );
  }
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Mirror of lib/secrets.ts mask — first 6 + "..." + last 4. */
function mask(value: string): string {
  if (value.length < 10) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const encryptionKey = process.env.SECRET_ENCRYPTION_KEY;
  const openRouterKey = process.env.OPENROUTER_BOOTSTRAP_KEY;

  if (!url || !serviceRoleKey || !encryptionKey) {
    console.error(
      "Missing one of NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, " +
        "SECRET_ENCRYPTION_KEY (check .env.local)."
    );
    process.exit(1);
  }
  if (!openRouterKey) {
    console.error(
      "Set the key in the environment, e.g.:\n" +
        "  OPENROUTER_BOOTSTRAP_KEY=sk-or-... npm run seed:key"
    );
    process.exit(1);
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await supabase.from("system_secrets").upsert(
    {
      key: SECRET_KEY,
      value_encrypted: encrypt(openRouterKey, encryptionKey),
      value_masked: mask(openRouterKey),
      description: "OpenRouter API key (seeded via scripts/seed-openrouter-key.ts).",
    },
    { onConflict: "key" }
  );

  if (error) {
    console.error(`Failed to seed ${SECRET_KEY}: ${error.message}`);
    process.exit(1);
  }

  // Never print the raw key — masked confirmation only.
  console.log(`✓ Seeded "${SECRET_KEY}" into system_secrets (${mask(openRouterKey)}).`);
}

main();
