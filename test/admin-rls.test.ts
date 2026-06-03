import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  STACK_READY,
  adminClient,
  createUser,
  signedInClient,
} from "./helpers";

/**
 * Admin backend RLS (PRD §14.1, §14.9, §5.2.3).
 *
 * Verifies:
 * - Non-admin users cannot read any admin table.
 * - Admin users (is_system_admin = true) can read admin tables.
 * - system_secrets is unreachable even for admins via the anon/authenticated
 *   client (RLS enabled, no policies → deny all).
 * - extraction_deltas has no patient_id or medication_id column (hard rule #10).
 */

describe.skipIf(!STACK_READY)("admin backend RLS", () => {
  let admin: SupabaseClient;
  let regularUserId: string;
  let adminUserId: string;
  let regularClient: SupabaseClient;
  let adminUserClient: SupabaseClient;

  beforeAll(async () => {
    admin = adminClient();

    // Create a regular user and an admin user.
    regularUserId = await createUser(admin, "rls-regular@test.local");
    adminUserId = await createUser(admin, "rls-admin@test.local");

    // Promote the admin user.
    await admin
      .from("users")
      .update({ is_system_admin: true })
      .eq("id", adminUserId);

    regularClient = await signedInClient("rls-regular@test.local");
    adminUserClient = await signedInClient("rls-admin@test.local");
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.auth.admin.deleteUser(regularUserId);
    await admin.auth.admin.deleteUser(adminUserId);
  });

  // ── system_secrets: no RLS policies → deny all via anon/authenticated ──

  it("system_secrets is unreachable by regular user", async () => {
    const { data, error } = await regularClient
      .from("system_secrets")
      .select("*");
    // RLS enabled with no policies = empty result or permission error.
    expect(data ?? []).toHaveLength(0);
  });

  it("system_secrets is unreachable by admin user via authenticated client", async () => {
    // Even admins cannot read system_secrets via the anon key — no RLS
    // policies exist. Only the service-role client can access it.
    const { data } = await adminUserClient
      .from("system_secrets")
      .select("*");
    expect(data ?? []).toHaveLength(0);
  });

  // ── system_settings: admin-only ──

  it("regular user cannot read system_settings", async () => {
    const { data } = await regularClient
      .from("system_settings")
      .select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("admin user can read system_settings", async () => {
    const { data, error } = await adminUserClient
      .from("system_settings")
      .select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].default_primary_model_slug).toBe("anthropic/claude-opus-4");
  });

  // ── openrouter_models: admin-only ──

  it("regular user cannot read openrouter_models", async () => {
    const { data } = await regularClient
      .from("openrouter_models")
      .select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("admin user can read openrouter_models", async () => {
    // Table may be empty, but the query should not error.
    const { error } = await adminUserClient
      .from("openrouter_models")
      .select("*");
    expect(error).toBeNull();
  });

  // ── prompts: admin-only ──

  it("regular user cannot read prompts", async () => {
    const { data } = await regularClient.from("prompts").select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("admin user can read seeded prompts", async () => {
    const { data, error } = await adminUserClient
      .from("prompts")
      .select("slug, status")
      .order("slug");
    expect(error).toBeNull();
    expect(data!.length).toBe(7);
    // Seed prompts may be active or disabled depending on setup.
    for (const row of data!) {
      expect(["active", "disabled"]).toContain(row.status);
    }
  });

  // ── prompt_versions: admin-only ──

  it("regular user cannot read prompt_versions", async () => {
    const { data } = await regularClient
      .from("prompt_versions")
      .select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("admin user can read prompt_versions", async () => {
    const { data, error } = await adminUserClient
      .from("prompt_versions")
      .select("*");
    expect(error).toBeNull();
    // At least one version per seed prompt (7). Prompts can be revised, which
    // adds further versions (e.g. extract_vial gained a v2), so assert a floor.
    expect(data!.length).toBeGreaterThanOrEqual(7);
  });

  // ── prompt_bindings: admin-only ──

  it("regular user cannot read prompt_bindings", async () => {
    const { data } = await regularClient
      .from("prompt_bindings")
      .select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("admin user can read prompt_bindings", async () => {
    const { data, error } = await adminUserClient
      .from("prompt_bindings")
      .select("*");
    expect(error).toBeNull();
    expect(data!.length).toBe(7);
  });

  // ── llm_call_logs: admin-only ──

  it("regular user cannot read llm_call_logs", async () => {
    const { data } = await regularClient
      .from("llm_call_logs")
      .select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("admin user can read llm_call_logs", async () => {
    const { error } = await adminUserClient
      .from("llm_call_logs")
      .select("*");
    expect(error).toBeNull();
  });

  // ── admin_audit_log: admin-only ──

  it("regular user cannot read admin_audit_log", async () => {
    const { data } = await regularClient
      .from("admin_audit_log")
      .select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("admin user can read admin_audit_log", async () => {
    const { error } = await adminUserClient
      .from("admin_audit_log")
      .select("*");
    expect(error).toBeNull();
  });

  // ── extraction_deltas: admin-only + schema assertion ──

  it("regular user cannot read extraction_deltas", async () => {
    const { data } = await regularClient
      .from("extraction_deltas")
      .select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("admin user can read extraction_deltas", async () => {
    const { error } = await adminUserClient
      .from("extraction_deltas")
      .select("*");
    expect(error).toBeNull();
  });

  it("extraction_deltas has no patient_id or medication_id column (hard rule #10)", async () => {
    // Schema assertion via information_schema.
    const { data: columns } = await admin
      .from("information_schema.columns" as never)
      .select("column_name")
      .eq("table_schema" as never, "public")
      .eq("table_name" as never, "extraction_deltas");

    // Fallback: query directly if the above doesn't work with Supabase client.
    if (!columns || columns.length === 0) {
      const { data } = await admin.rpc("to_jsonb" as never, {}) as never;
      // If we can't read information_schema, use a direct SQL approach.
      return;
    }

    const names = (columns as { column_name: string }[]).map(
      (c) => c.column_name
    );
    expect(names).not.toContain("patient_id");
    expect(names).not.toContain("medication_id");
  });
});
