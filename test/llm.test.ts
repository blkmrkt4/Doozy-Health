import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STACK_READY, adminClient, createUser } from "./helpers";
import { randomBytes } from "node:crypto";

/**
 * LLM gateway tests (PRD §14.6, §15).
 *
 * callOpenRouter is mocked — no live OpenRouter calls ever (PRD §15).
 * Tests cover: template rendering, fallback chain, disabled prompt, image
 * attachment, and llm_call_logs writes.
 *
 * Both lib/llm and lib/secrets use server-only imports that require env vars
 * available only when the local Supabase stack is running. All imports are
 * dynamic so the test file can be collected without throwing.
 */

// ── renderTemplate (pure function, but importing lib/llm triggers env
// validation so we skip when the stack isn't ready) ─────────────────────────

describe.skipIf(!STACK_READY)("renderTemplate", () => {
  it("substitutes {{var}} placeholders", async () => {
    const { renderTemplate } = await import("@/lib/llm");
    const body = "Hello {{name}}, you have {{count}} medications.";
    const result = renderTemplate(body, { name: "Alice", count: "3" });
    expect(result).toBe("Hello Alice, you have 3 medications.");
  });

  it("leaves missing vars intact (PRD §14.6)", async () => {
    const { renderTemplate } = await import("@/lib/llm");
    const body = "Known: {{known_medications}}. Unknown: {{missing_var}}.";
    const result = renderTemplate(body, { known_medications: "Aspirin" });
    expect(result).toBe("Known: Aspirin. Unknown: {{missing_var}}.");
  });

  it("handles body with no placeholders", async () => {
    const { renderTemplate } = await import("@/lib/llm");
    expect(renderTemplate("No vars here.", {})).toBe("No vars here.");
  });

  it("handles empty vars", async () => {
    const { renderTemplate } = await import("@/lib/llm");
    const body = "{{a}} and {{b}}";
    expect(renderTemplate(body, {})).toBe("{{a}} and {{b}}");
  });
});

// ── Integration tests (need the Supabase stack) ──────────────────────────

describe.skipIf(!STACK_READY)("llmCall integration", () => {
  let admin: SupabaseClient;
  let testAdminId: string;

  const TEST_SLUG = "test_llm_prompt";

  beforeAll(async () => {
    admin = adminClient();

    testAdminId = await createUser(admin, "llm-test-admin@test.local");
    await admin
      .from("users")
      .update({ is_system_admin: true })
      .eq("id", testAdminId);

    // readSecret is mocked in every test — no need to seed system_secrets.

    // Create a test prompt (active, with version and binding).
    // Insert prompt first without current_version_id (deferrable FK),
    // then insert version, then backfill the FK.
    const promptId = crypto.randomUUID();
    const versionId = crypto.randomUUID();

    await admin.from("prompts").insert({
      id: promptId,
      slug: TEST_SLUG,
      name: "Test prompt",
      description: "For llm.test.ts",
      purpose: "other",
      current_version_id: null,
      status: "active",
    });

    await admin.from("prompt_versions").insert({
      id: versionId,
      prompt_id: promptId,
      version_number: 1,
      body: "Hello {{name}}, describe {{topic}}.",
      available_slugs: JSON.stringify(["name", "topic"]),
      notes: "Test version",
      created_by: null,
    });

    await admin
      .from("prompts")
      .update({ current_version_id: versionId })
      .eq("id", promptId);

    await admin.from("prompt_bindings").insert({
      prompt_id: promptId,
      primary_model_slug: "test/primary-model",
      fallback_1_model_slug: "test/fallback-1",
      fallback_2_model_slug: "test/fallback-2",
      temperature: 0.2,
      max_tokens: 1024,
      response_format: "text",
    });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from("llm_call_logs").delete().eq("prompt_slug", TEST_SLUG);
    await admin.from("prompt_bindings").delete().eq("prompt_id",
      (await admin.from("prompts").select("id").eq("slug", TEST_SLUG).single()).data?.id ?? "");
    await admin.from("prompts").delete().eq("slug", TEST_SLUG);
    // Don't delete the real openrouter_api_key — tests mock readSecret.
    await admin.auth.admin.deleteUser(testAdminId);
  });

  it("llmCall returns success when primary model works", async () => {
    const llmModule = await import("@/lib/llm");
    const openrouterModule = await import("@/lib/openrouter");
    const secretsModule = await import("@/lib/secrets");

    const spy = vi
      .spyOn(openrouterModule, "callOpenRouter")
      .mockResolvedValueOnce({
        text: "Primary response",
        inputTokens: 10,
        outputTokens: 20,
      });
    vi.spyOn(secretsModule, "getOpenRouterApiKey").mockResolvedValue(
      "sk-or-v1-fake-test-key"
    );

    const result = await llmModule.llmCall(TEST_SLUG, {
      name: "Alice",
      topic: "wellness",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("Primary response");
      expect(result.modelUsed).toBe("test/primary-model");
      expect(result.wasFallback).toBe(0);
    }

    expect(spy).toHaveBeenCalledOnce();
    const callArgs = spy.mock.calls[0];
    expect(callArgs[0]).toBe("sk-or-v1-fake-test-key");
    expect(callArgs[1]).toBe("test/primary-model");
    const messages = callArgs[2];
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello Alice, describe wellness.");

    spy.mockRestore();
    vi.restoreAllMocks();
  });

  it("falls back when primary fails", async () => {
    const llmModule = await import("@/lib/llm");
    const openrouterModule = await import("@/lib/openrouter");
    const secretsModule = await import("@/lib/secrets");

    vi.spyOn(openrouterModule, "callOpenRouter")
      .mockRejectedValueOnce(new Error("Primary timeout"))
      .mockResolvedValueOnce({
        text: "Fallback 1 response",
        inputTokens: 15,
        outputTokens: 25,
      });
    vi.spyOn(secretsModule, "getOpenRouterApiKey").mockResolvedValue("fake-key");

    const result = await llmModule.llmCall(TEST_SLUG, {
      name: "Bob",
      topic: "meds",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("Fallback 1 response");
      expect(result.modelUsed).toBe("test/fallback-1");
      expect(result.wasFallback).toBe(1);
    }

    vi.restoreAllMocks();
  });

  it("returns ok: false when all models fail", async () => {
    const llmModule = await import("@/lib/llm");
    const openrouterModule = await import("@/lib/openrouter");
    const secretsModule = await import("@/lib/secrets");

    vi.spyOn(openrouterModule, "callOpenRouter")
      .mockRejectedValueOnce(new Error("Primary fail"))
      .mockRejectedValueOnce(new Error("Fallback 1 fail"))
      .mockRejectedValueOnce(new Error("Fallback 2 fail"));
    vi.spyOn(secretsModule, "getOpenRouterApiKey").mockResolvedValue("fake-key");

    const result = await llmModule.llmCall(TEST_SLUG, {
      name: "X",
      topic: "Y",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("All models failed.");
      expect(result.attempts).toHaveLength(3);
      expect(result.attempts[0].model).toBe("test/primary-model");
      expect(result.attempts[0].wasFallback).toBe(0);
      expect(result.attempts[1].model).toBe("test/fallback-1");
      expect(result.attempts[1].wasFallback).toBe(1);
      expect(result.attempts[2].model).toBe("test/fallback-2");
      expect(result.attempts[2].wasFallback).toBe(2);
    }

    vi.restoreAllMocks();
  });

  it("returns error for disabled/missing prompt without calling OpenRouter", async () => {
    const llmModule = await import("@/lib/llm");
    const openrouterModule = await import("@/lib/openrouter");
    const spy = vi.spyOn(openrouterModule, "callOpenRouter");

    // Use a slug that doesn't exist — should return "not found".
    const result = await llmModule.llmCall("nonexistent_test_prompt_xyz", {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
      expect(result.attempts).toHaveLength(0);
    }
    expect(spy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("returns error for non-existent prompt", async () => {
    const llmModule = await import("@/lib/llm");
    const result = await llmModule.llmCall("nonexistent_slug_xyz", {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
    }
  });

  it("attaches images as multipart content array", async () => {
    const llmModule = await import("@/lib/llm");
    const openrouterModule = await import("@/lib/openrouter");
    const secretsModule = await import("@/lib/secrets");

    const spy = vi
      .spyOn(openrouterModule, "callOpenRouter")
      .mockResolvedValueOnce({
        text: "Saw the image",
        inputTokens: 50,
        outputTokens: 10,
      });
    vi.spyOn(secretsModule, "getOpenRouterApiKey").mockResolvedValue("fake-key");

    const fakeImage = "data:image/jpeg;base64,/9j/4AAQ...";
    const result = await llmModule.llmCall(
      TEST_SLUG,
      { name: "Test", topic: "vial" },
      { images: [fakeImage] }
    );

    expect(result.ok).toBe(true);

    const messages = spy.mock.calls[0][2];
    const userMsg = messages.find((m) => m.role === "user")!;
    expect(Array.isArray(userMsg.content)).toBe(true);

    const parts = userMsg.content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(parts[0].type).toBe("text");
    expect(parts[0].text).toContain("Hello Test");
    expect(parts[1].type).toBe("image_url");
    expect(parts[1].image_url?.url).toBe(fakeImage);

    vi.restoreAllMocks();
  });

  it("writes llm_call_logs entries", async () => {
    const llmModule = await import("@/lib/llm");
    const openrouterModule = await import("@/lib/openrouter");
    const secretsModule = await import("@/lib/secrets");

    // Clear existing logs.
    await admin
      .from("llm_call_logs")
      .delete()
      .eq("prompt_slug", TEST_SLUG);

    vi.spyOn(openrouterModule, "callOpenRouter")
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce({
        text: "ok",
        inputTokens: 5,
        outputTokens: 10,
      });
    vi.spyOn(secretsModule, "getOpenRouterApiKey").mockResolvedValue("fake-key");

    await llmModule.llmCall(TEST_SLUG, { name: "Log", topic: "test" });

    const { data: logs } = await admin
      .from("llm_call_logs")
      .select("*")
      .eq("prompt_slug", TEST_SLUG)
      .order("created_at", { ascending: true });

    expect(logs).toHaveLength(2);
    expect(logs![0].model_used).toBe("test/primary-model");
    expect(logs![0].was_fallback).toBe(0);
    expect(logs![0].success).toBe(false);
    expect(logs![0].error_message).toBe("fail");
    expect(logs![1].model_used).toBe("test/fallback-1");
    expect(logs![1].was_fallback).toBe(1);
    expect(logs![1].success).toBe(true);
    expect(logs![1].input_tokens).toBe(5);
    expect(logs![1].output_tokens).toBe(10);

    vi.restoreAllMocks();
  });
});
