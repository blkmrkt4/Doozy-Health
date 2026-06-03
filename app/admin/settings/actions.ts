"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSystemAdmin } from "@/lib/admin";
import { writeSecret, readSecret } from "@/lib/secrets";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncModels } from "@/lib/models";

// ── Helpers ────────────────────────────────────────────────────────────────

function str(fd: FormData, key: string): string {
  return (fd.get(key) as string | null)?.trim() ?? "";
}

function fail(message: string): never {
  redirect(`/admin/settings?error=${encodeURIComponent(message)}`);
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

// ── Actions ────────────────────────────────────────────────────────────────

export async function saveApiKey(formData: FormData) {
  const admin = await requireSystemAdmin();
  const key = str(formData, "api_key");
  if (!key) fail("Enter an API key.");

  const svc = createAdminClient();
  await writeSecret("openrouter_api_key", key, "OpenRouter API key", admin.id);
  await auditLog(svc, admin.id, "system_secret", "openrouter_api_key", "update", "secret updated");

  revalidatePath("/admin/settings");
  redirect("/admin/settings?success=API+key+saved");
}

/**
 * Reveal the decrypted OpenRouter key to a system admin, so an existing key can
 * be reused on another machine / cloud project without minting a new one.
 *
 * DELIBERATE EXCEPTION to the CLAUDE.md rule "never return the raw value": it is
 * gated to system admins (requireSystemAdmin → 404 for everyone else), scoped to
 * this single key only, and every reveal is written to admin_audit_log. Approved
 * by the owner. Do NOT generalise this to arbitrary secrets.
 */
export async function revealOpenRouterKey(): Promise<
  { ok: true; value: string } | { ok: false; error: string }
> {
  const admin = await requireSystemAdmin();

  let value: string;
  try {
    value = await readSecret("openrouter_api_key");
  } catch {
    return { ok: false, error: "No OpenRouter key is configured." };
  }

  const svc = createAdminClient();
  // 'view_source' is the audit action for viewing sensitive content (the
  // admin_audit_log.action CHECK only allows create/update/delete/view_source).
  await auditLog(
    svc,
    admin.id,
    "system_secret",
    "openrouter_api_key",
    "view_source",
    "openrouter key revealed"
  );

  return { ok: true, value };
}

export async function saveDefaultModels(formData: FormData) {
  const admin = await requireSystemAdmin();
  const primary = str(formData, "default_primary");
  const fallback1 = str(formData, "default_fallback_1");
  const fallback2 = str(formData, "default_fallback_2");

  if (!primary) fail("A default primary model is required.");

  const svc = createAdminClient();

  const { data: before } = await svc
    .from("system_settings")
    .select("default_primary_model_slug, default_fallback_1_model_slug, default_fallback_2_model_slug")
    .single();

  const { error } = await svc
    .from("system_settings")
    .update({
      default_primary_model_slug: primary,
      default_fallback_1_model_slug: fallback1 || primary,
      default_fallback_2_model_slug: fallback2 || primary,
      updated_by: admin.id,
    })
    .eq("id", true);

  if (error) fail(`Failed to save: ${error.message}`);

  await auditLog(svc, admin.id, "system_settings", "singleton", "update", {
    before,
    after: { primary, fallback_1: fallback1, fallback_2: fallback2 },
  });

  revalidatePath("/admin/settings");
  redirect("/admin/settings?success=Default+models+saved");
}

export async function refreshModelCatalogue() {
  const admin = await requireSystemAdmin();
  const svc = createAdminClient();

  let result;
  try {
    result = await syncModels(svc);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    fail(`Model sync failed: ${msg}`);
  }

  await auditLog(svc, admin.id, "openrouter_models", "catalogue", "update", {
    total: result.total,
    upserted: result.upserted,
    deactivated: result.deactivated,
  });

  revalidatePath("/admin/settings");
  redirect(
    `/admin/settings?success=${encodeURIComponent(
      `Synced ${result.upserted} models, deactivated ${result.deactivated}`
    )}`
  );
}
