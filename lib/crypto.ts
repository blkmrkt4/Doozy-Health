import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

// AES-256-GCM encrypt/decrypt for system_secrets (PRD §6.2, §14.3).
// Envelope format: "iv-hex:tag-hex:ciphertext-hex".

const ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12; // 96-bit IV, GCM standard
const TAG_BYTES = 16; // 128-bit auth tag

function parseKey(keyHex: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)."
    );
  }
  return Buffer.from(keyHex, "hex");
}

/** Encrypt plaintext → "iv:tag:ciphertext" (all hex). */
export function encrypt(plaintext: string, keyHex: string): string {
  const key = parseKey(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Decrypt an "iv:tag:ciphertext" envelope back to plaintext. */
export function decrypt(envelope: string, keyHex: string): string {
  const key = parseKey(keyHex);
  const parts = envelope.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid envelope format — expected iv:tag:ciphertext.");
  }

  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const ciphertext = Buffer.from(parts[2], "hex");

  if (iv.length !== IV_BYTES) {
    throw new Error(`Invalid IV length: expected ${IV_BYTES}, got ${iv.length}.`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error(
      `Invalid auth tag length: expected ${TAG_BYTES}, got ${tag.length}.`
    );
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(), // throws on tag mismatch
  ]);

  return decrypted.toString("utf8");
}
