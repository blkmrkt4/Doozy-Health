import { describe, expect, it } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";
import { randomBytes } from "node:crypto";

// Unit tests for the AES-256-GCM envelope used by system_secrets (PRD §6.2).
// No Supabase stack needed — pure crypto.

// A valid 32-byte key (64 hex chars).
const KEY = randomBytes(32).toString("hex");
const OTHER_KEY = randomBytes(32).toString("hex");

describe("lib/crypto", () => {
  it("round-trips plaintext through encrypt → decrypt", () => {
    const plaintext = "sk-or-v1-abc123-secret-key-value";
    const envelope = encrypt(plaintext, KEY);
    expect(decrypt(envelope, KEY)).toBe(plaintext);
  });

  it("handles empty string", () => {
    const envelope = encrypt("", KEY);
    expect(decrypt(envelope, KEY)).toBe("");
  });

  it("handles unicode", () => {
    const plaintext = "WellKept — wellness diary tool";
    const envelope = encrypt(plaintext, KEY);
    expect(decrypt(envelope, KEY)).toBe(plaintext);
  });

  it("produces a three-part colon-separated envelope", () => {
    const envelope = encrypt("test", KEY);
    const parts = envelope.split(":");
    expect(parts).toHaveLength(3);
    // IV = 12 bytes = 24 hex chars
    expect(parts[0]).toHaveLength(24);
    // Tag = 16 bytes = 32 hex chars
    expect(parts[1]).toHaveLength(32);
    // Ciphertext length varies with plaintext
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const a = encrypt("same-input", KEY);
    const b = encrypt("same-input", KEY);
    expect(a).not.toBe(b);
    // But both decrypt to the same value.
    expect(decrypt(a, KEY)).toBe("same-input");
    expect(decrypt(b, KEY)).toBe("same-input");
  });

  it("throws on wrong key", () => {
    const envelope = encrypt("secret", KEY);
    expect(() => decrypt(envelope, OTHER_KEY)).toThrow();
  });

  it("throws on tampered ciphertext", () => {
    const envelope = encrypt("secret", KEY);
    const parts = envelope.split(":");
    // Flip a byte in the ciphertext.
    const tampered =
      parts[2][0] === "a"
        ? "b" + parts[2].slice(1)
        : "a" + parts[2].slice(1);
    expect(() => decrypt(`${parts[0]}:${parts[1]}:${tampered}`, KEY)).toThrow();
  });

  it("throws on tampered auth tag", () => {
    const envelope = encrypt("secret", KEY);
    const parts = envelope.split(":");
    const tampered =
      parts[1][0] === "a"
        ? "b" + parts[1].slice(1)
        : "a" + parts[1].slice(1);
    expect(() => decrypt(`${parts[0]}:${tampered}:${parts[2]}`, KEY)).toThrow();
  });

  it("throws on invalid envelope format", () => {
    expect(() => decrypt("not-an-envelope", KEY)).toThrow(
      "Invalid envelope format"
    );
    expect(() => decrypt("aa:bb", KEY)).toThrow("Invalid envelope format");
  });

  it("throws on invalid key length", () => {
    expect(() => encrypt("test", "tooshort")).toThrow("64 hex characters");
    expect(() => decrypt("aa:bb:cc", "tooshort")).toThrow("64 hex characters");
  });
});
