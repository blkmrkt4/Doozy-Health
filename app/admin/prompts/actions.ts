"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSystemAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { llmCall, type LlmCallResult } from "@/lib/llm";

// ── Helpers ────────────────────────────────────────────────────────────────

function str(fd: FormData, key: string): string {
  return (fd.get(key) as string | null)?.trim() ?? "";
}

function failTo(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

async function auditLog(
  admin: ReturnType<typeof createAdminClient>,
  actorId: string,
  entity: string,
  entityId: string,
  action: string,
  diff: unknown
) {
  await admin.from("admin_audit_log").insert({
    actor_id: actorId,
    entity,
    entity_id: entityId,
    action,
    diff,
  });
}

// ── Create prompt ──────────────────────────────────────────────────────────

export async function createPrompt(formData: FormData) {
  const admin = await requireSystemAdmin();
  const slug = str(formData, "slug");
  const name = str(formData, "name");
  const purpose = str(formData, "purpose") || "other";

  if (!slug) failTo("/admin/prompts/new", "Slug is required.");
  if (!/^[a-z][a-z0-9_]*$/.test(slug)) {
    failTo(
      "/admin/prompts/new",
      "Slug must start with a letter and contain only lowercase letters, numbers, and underscores."
    );
  }
  if (!name) failTo("/admin/prompts/new", "Name is required.");

  const svc = createAdminClient();

  // Check for duplicate slug.
  const { data: existing } = await svc
    .from("prompts")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) failTo("/admin/prompts/new", `Slug "${slug}" already exists.`);

  // Load defaults from system_settings.
  const { data: settings } = await svc
    .from("system_settings")
    .select("default_primary_model_slug, default_fallback_1_model_slug, default_fallback_2_model_slug")
    .single();

  const promptId = crypto.randomUUID();
  const versionId = crypto.randomUUID();

  // Insert prompt (deferrable FK on current_version_id).
  const { error: pErr } = await svc.from("prompts").insert({
    id: promptId,
    slug,
    name,
    description: str(formData, "description"),
    purpose,
    current_version_id: versionId,
    status: "disabled",
  });
  if (pErr) failTo("/admin/prompts/new", `Failed to create: ${pErr.message}`);

  await svc.from("prompt_versions").insert({
    id: versionId,
    prompt_id: promptId,
    version_number: 1,
    body: "Placeholder — write the real body before enabling.",
    available_slugs: "[]",
    notes: "Initial version",
    created_by: admin.id,
  });

  await svc.from("prompt_bindings").insert({
    prompt_id: promptId,
    primary_model_slug: settings?.default_primary_model_slug ?? "anthropic/claude-opus-4",
    fallback_1_model_slug: settings?.default_fallback_1_model_slug ?? "anthropic/claude-sonnet-4",
    fallback_2_model_slug: settings?.default_fallback_2_model_slug ?? "openai/gpt-4o",
    updated_by: admin.id,
  });

  await auditLog(svc, admin.id, "prompt", promptId, "create", { slug, name, purpose });

  revalidatePath("/admin/prompts");
  redirect(`/admin/prompts/${slug}`);
}

// ── Update prompt metadata ─────────────────────────────────────────────────

export async function updatePrompt(formData: FormData) {
  const admin = await requireSystemAdmin();
  const slug = str(formData, "slug");
  const name = str(formData, "name");
  const description = str(formData, "description");
  const purpose = str(formData, "purpose");
  const status = str(formData, "status");

  if (!slug) failTo("/admin/prompts", "Missing slug.");
  if (!name) failTo(`/admin/prompts/${slug}`, "Name is required.");

  const svc = createAdminClient();

  const { data: before } = await svc
    .from("prompts")
    .select("name, description, purpose, status")
    .eq("slug", slug)
    .single();

  const { error } = await svc
    .from("prompts")
    .update({ name, description, purpose, status })
    .eq("slug", slug);

  if (error) failTo(`/admin/prompts/${slug}`, `Failed to update: ${error.message}`);

  await auditLog(svc, admin.id, "prompt", slug, "update", {
    before,
    after: { name, description, purpose, status },
  });

  revalidatePath("/admin/prompts");
  revalidatePath(`/admin/prompts/${slug}`);
  redirect(`/admin/prompts/${slug}?success=Prompt+updated`);
}

// ── Save prompt body (new version) ─────────────────────────────────────────

export async function savePromptBody(formData: FormData) {
  const admin = await requireSystemAdmin();
  const slug = str(formData, "slug");
  const body = str(formData, "body");
  const availableSlugsRaw = str(formData, "available_slugs");
  const notes = str(formData, "notes");

  if (!slug) failTo("/admin/prompts", "Missing slug.");
  if (!body) failTo(`/admin/prompts/${slug}`, "Body cannot be empty.");

  const svc = createAdminClient();

  // Get prompt id and current version number.
  const { data: prompt } = await svc
    .from("prompts")
    .select("id")
    .eq("slug", slug)
    .single();
  if (!prompt) failTo("/admin/prompts", `Prompt "${slug}" not found.`);

  const { data: versions } = await svc
    .from("prompt_versions")
    .select("version_number")
    .eq("prompt_id", prompt.id)
    .order("version_number", { ascending: false })
    .limit(1);

  const nextVersion = ((versions?.[0]?.version_number as number) ?? 0) + 1;
  const versionId = crypto.randomUUID();

  // Parse available_slugs (comma-separated or JSON).
  let availableSlugs: string[];
  try {
    availableSlugs = JSON.parse(availableSlugsRaw);
    if (!Array.isArray(availableSlugs)) throw new Error();
  } catch {
    availableSlugs = availableSlugsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const { error: vErr } = await svc.from("prompt_versions").insert({
    id: versionId,
    prompt_id: prompt.id,
    version_number: nextVersion,
    body,
    available_slugs: JSON.stringify(availableSlugs),
    notes,
    created_by: admin.id,
  });
  if (vErr) failTo(`/admin/prompts/${slug}`, `Failed to save version: ${vErr.message}`);

  // Update prompt.current_version_id.
  await svc
    .from("prompts")
    .update({ current_version_id: versionId })
    .eq("id", prompt.id);

  await auditLog(svc, admin.id, "prompt_version", versionId, "create", {
    slug,
    version: nextVersion,
  });

  revalidatePath(`/admin/prompts/${slug}`);
  redirect(`/admin/prompts/${slug}?success=Version+${nextVersion}+saved`);
}

// ── Save model binding ─────────────────────────────────────────────────────

export async function saveBinding(formData: FormData) {
  const admin = await requireSystemAdmin();
  const slug = str(formData, "slug");
  const primary = str(formData, "primary_model_slug");
  const fallback1 = str(formData, "fallback_1_model_slug");
  const fallback2 = str(formData, "fallback_2_model_slug");
  const temperature = Number(str(formData, "temperature")) || 0.2;
  const maxTokens = Number(str(formData, "max_tokens")) || 2048;
  const responseFormat = str(formData, "response_format") || "text";
  const jsonSchema = str(formData, "json_schema");

  if (!slug) failTo("/admin/prompts", "Missing slug.");
  if (!primary) failTo(`/admin/prompts/${slug}`, "Primary model is required.");

  const svc = createAdminClient();

  const { data: prompt } = await svc
    .from("prompts")
    .select("id")
    .eq("slug", slug)
    .single();
  if (!prompt) failTo("/admin/prompts", `Prompt "${slug}" not found.`);

  let parsedSchema = null;
  if (responseFormat === "json" && jsonSchema) {
    try {
      parsedSchema = JSON.parse(jsonSchema);
    } catch {
      failTo(`/admin/prompts/${slug}`, "Invalid JSON schema.");
    }
  }

  const { error } = await svc.from("prompt_bindings").upsert(
    {
      prompt_id: prompt.id,
      primary_model_slug: primary,
      fallback_1_model_slug: fallback1 || null,
      fallback_2_model_slug: fallback2 || null,
      temperature,
      max_tokens: maxTokens,
      response_format: responseFormat,
      json_schema: parsedSchema,
      updated_by: admin.id,
    },
    { onConflict: "prompt_id" }
  );

  if (error) failTo(`/admin/prompts/${slug}`, `Failed to save binding: ${error.message}`);

  await auditLog(svc, admin.id, "prompt_binding", slug, "update", {
    primary,
    fallback_1: fallback1,
    fallback_2: fallback2,
    temperature,
    max_tokens: maxTokens,
    response_format: responseFormat,
  });

  revalidatePath(`/admin/prompts/${slug}`);
  redirect(`/admin/prompts/${slug}?success=Binding+saved`);
}

// ── Test prompt ────────────────────────────────────────────────────────────

export async function testPrompt(formData: FormData): Promise<LlmCallResult> {
  const admin = await requireSystemAdmin();
  const slug = str(formData, "slug");
  if (!slug) return { ok: false, error: "Missing slug.", attempts: [] };

  // Rate limit: 10 test calls / min / admin (PRD §14.4.2).
  const svc = createAdminClient();
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count } = await svc
    .from("llm_call_logs")
    .select("id", { count: "exact", head: true })
    .eq("was_test", true)
    .eq("actor_id", admin.id)
    .gte("created_at", oneMinuteAgo);

  if ((count ?? 0) >= 10) {
    return {
      ok: false,
      error: "Rate limit: max 10 test calls per minute.",
      attempts: [],
    };
  }

  // Gather variables from form data (keys prefixed with "var_").
  const vars: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("var_") && typeof value === "string") {
      vars[key.slice(4)] = value;
    }
  }

  // Gather images (if any).
  const images: string[] = [];
  const imageFiles = formData.getAll("test_images");
  for (const file of imageFiles) {
    if (file instanceof File && file.size > 0) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const base64 = buffer.toString("base64");
      images.push(`data:${file.type};base64,${base64}`);
    }
  }

  return llmCall(slug, vars, {
    wasTest: true,
    actorId: admin.id,
    images: images.length > 0 ? images : undefined,
  });
}
