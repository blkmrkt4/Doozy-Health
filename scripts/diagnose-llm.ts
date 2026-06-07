import { config } from "dotenv";
import { deflateSync } from "node:zlib";

// LLM / DB connectivity diagnostic (PRD §14). Answers, in order:
//   1. Can we reach the database with the SERVICE-ROLE (secret) key?
//   2. Is the OpenRouter key present and decryptable in system_secrets?
//   3. Are the extraction prompts active + bound to a model?
//   4. Does an actual image call succeed through llmCall (the gateway)?
// It never calls OpenRouter directly (hard rule #1) — step 4 goes through
// llmCall. Run with:  npx vite-node scripts/diagnose-llm.ts
//
// dotenv must load BEFORE importing app modules (lib/env reads process.env at
// import time), so app modules are imported dynamically after config().
// Point it at another environment (e.g. production) with ENV_FILE:
//   ENV_FILE=.env.production npx vite-node scripts/diagnose-llm.ts
config({ path: process.env.ENV_FILE || ".env.local" });

const mask = (v?: string | null) =>
  v ? `${v.slice(0, 6)}…${v.slice(-4)} (${v.length} chars)` : "(missing)";
const line = (ok: boolean, msg: string) => console.log(`  ${ok ? "✓" : "✗"} ${msg}`);

// Build a VALID solid-colour RGB PNG data URL (a real, decodable image) so
// step 4 is a positive control: if a proper image succeeds, the key + model +
// image path all work, and only the user's photo FORMAT (e.g. iPhone HEIC) is
// the problem.
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function validPngDataUrl(size = 48): string {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const row = Buffer.alloc(1 + size * 3); // filter byte 0 + RGB pixels
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = 80;
    row[1 + x * 3 + 1] = 90;
    row[1 + x * 3 + 2] = 110;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const png = Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function main() {
  console.log("\n══════ Doozy LLM / DB diagnostic ══════\n");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const enc = process.env.SECRET_ENCRYPTION_KEY;
  console.log("Environment (.env.local):");
  line(!!url, `NEXT_PUBLIC_SUPABASE_URL: ${url ?? "(missing)"}`);
  line(!!svc, `SUPABASE_SERVICE_ROLE_KEY: ${mask(svc)}`);
  line(!!enc, `SECRET_ENCRYPTION_KEY: ${enc ? `set (${enc.length} chars)` : "(missing)"}`);
  console.log();

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { readSecret } = await import("@/lib/secrets");
  const { llmCall } = await import("@/lib/llm");

  // 1. Database access with the service-role key.
  console.log("1) Database access with the service-role (secret) key:");
  const admin = createAdminClient();
  const { error: dbErr, count } = await admin
    .from("prompts")
    .select("slug", { count: "exact", head: true });
  if (dbErr) line(false, `service-role query FAILED: ${dbErr.message}`);
  else line(true, `service-role can read prompts (${count ?? "?"} rows).`);

  const { data: secretsRows, error: secErr } = await admin
    .from("system_secrets")
    .select("key, value_masked");
  if (secErr) line(false, `cannot read system_secrets: ${secErr.message}`);
  else
    line(
      (secretsRows ?? []).length > 0,
      `system_secrets readable — keys: ${(secretsRows ?? []).map((r) => r.key).join(", ") || "(none stored!)"}`
    );
  console.log();

  // 2. OpenRouter key read + decrypt.
  console.log("2) OpenRouter API key (read + decrypt from system_secrets):");
  let keyOk = false;
  try {
    const key = await readSecret("openrouter_api_key");
    keyOk = true;
    line(
      true,
      `decrypted OK: ${mask(key)} ${key.startsWith("sk-or-") ? "(OpenRouter prefix ✓)" : "(unexpected prefix — not sk-or-…!)"}`
    );
  } catch (e) {
    line(false, e instanceof Error ? e.message : String(e));
  }
  console.log();

  // 3. Extraction prompts: active + current version + bound model.
  console.log("3) Extraction prompts (active · current version · bound model):");
  for (const slug of ["extract_vial", "extract_syringe", "extract_prescription"]) {
    const { data: p, error } = await admin
      .from("prompts")
      .select("id, status, current_version_id")
      .eq("slug", slug)
      .maybeSingle();
    if (error) {
      line(false, `${slug}: query error ${error.message}`);
      continue;
    }
    if (!p) {
      line(false, `${slug}: NOT present in prompts table`);
      continue;
    }
    const { data: b } = await admin
      .from("prompt_bindings")
      .select("primary_model_slug, fallback_1_model_slug, fallback_2_model_slug")
      .eq("prompt_id", p.id)
      .maybeSingle();
    const ok = p.status === "active" && !!p.current_version_id && !!b?.primary_model_slug;
    const fbs = b ? [b.fallback_1_model_slug, b.fallback_2_model_slug].filter(Boolean).join(", ") || "none" : "n/a";
    line(
      ok,
      `${slug}: status=${p.status} · version=${p.current_version_id ? "yes" : "MISSING"} · model=${b?.primary_model_slug ?? "MISSING"} · fallbacks=${fbs}`
    );
  }
  console.log();

  // 4. End-to-end image call through the gateway (llmCall) with a VALID image.
  console.log("4) End-to-end image call through llmCall (valid 48×48 test image):");
  if (!keyOk) {
    line(false, "skipped — no usable OpenRouter key (see step 2).");
  } else {
    const res = await llmCall(
      "extract_vial",
      { known_medications: "", user_default_units: "mg" },
      { images: [validPngDataUrl(48)] }
    );
    if (res.ok) {
      line(true, `SUCCEEDED via ${res.modelUsed} (fallback level ${res.wasFallback}).`);
      console.log("     → Key, DB, model and image path ALL work with a valid image.");
      console.log("     → So a failing scan is the PHOTO FORMAT: iPhone HEIC (or oversize)");
      console.log("       reaches the model as data:image/heic and is rejected. Fix: send JPEG.");
    } else {
      line(false, `FAILED: ${res.error}`);
      for (const a of res.attempts ?? []) console.log(`     - ${a.model}: ${a.error}`);
      const joined = `${(res.attempts ?? []).map((a) => a.error).join(" | ")} ${res.error}`.toLowerCase();
      console.log("\n  Likely cause:");
      if (/image[_ ]?parse|could not process image|unsupported image|invalid image|image.*(decode|format|valid)/.test(joined))
        console.log("  → The IMAGE was rejected (format/size/encoding) — e.g. iPhone HEIC, oversized, or malformed base64. Convert to JPEG + downscale before sending.");
      else if (/401|unauthor|invalid api key|no auth|credential/.test(joined))
        console.log("  → OpenRouter KEY rejected (401/unauthorized). Re-seed it.");
      else if (/insufficient|quota|credit|payment|402|balance/.test(joined))
        console.log("  → OpenRouter account has no CREDIT / quota exhausted.");
      else if (/404|not a valid model|model.*(not found|unavailable)/.test(joined))
        console.log("  → Bound MODEL slug is wrong / unavailable on OpenRouter (see step 3).");
      else if (/vision|multimodal|modality|does not support/.test(joined))
        console.log("  → Bound model does NOT accept image input — bind a vision-capable model.");
      else if (/disabled|not found|no current version|binding/.test(joined))
        console.log("  → Prompt config problem — see step 3.");
      else if (/database|service-role/.test(joined))
        console.log("  → Database / service-role access problem — see step 1.");
      else console.log("  → See the raw error(s) above.");
    }
  }

  console.log("\n══════ done ══════\n");
}

main().catch((e) => {
  console.error("Diagnostic crashed:", e);
  process.exit(1);
});
