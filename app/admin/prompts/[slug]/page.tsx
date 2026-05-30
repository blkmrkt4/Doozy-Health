import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { PromptEditor } from "./prompt-editor";
import { ModelBinding } from "./model-binding";
import { TestPanel } from "./test-panel";
import type { ModelRow } from "@/app/admin/_components/model-picker";

// Prompt detail/edit page (PRD §14.4.2). Two-panel layout: left = editor,
// right = model binding. Test panel below. Stacked on mobile.

export default async function PromptDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { slug } = await params;
  const { error, success } = await searchParams;
  const svc = createAdminClient();

  // Load prompt.
  const { data: prompt } = await svc
    .from("prompts")
    .select("id, slug, name, description, purpose, current_version_id, status")
    .eq("slug", slug)
    .single();

  if (!prompt) notFound();

  // Load current version, binding, version history, and models in parallel.
  const [versionRes, bindingRes, historyRes, modelsRes] = await Promise.all([
    prompt.current_version_id
      ? svc
          .from("prompt_versions")
          .select("id, version_number, body, available_slugs, notes, created_at")
          .eq("id", prompt.current_version_id)
          .single()
      : Promise.resolve({ data: null }),
    svc
      .from("prompt_bindings")
      .select("*")
      .eq("prompt_id", prompt.id)
      .single(),
    svc
      .from("prompt_versions")
      .select("id, version_number, notes, created_by, created_at")
      .eq("prompt_id", prompt.id)
      .order("version_number", { ascending: false }),
    svc
      .from("openrouter_models")
      .select("slug, name, provider, context_length, input_cost_per_mtoken, output_cost_per_mtoken, supports_vision, supports_tools, supports_json_mode, is_coding_specialist, is_reasoning_specialist, is_available")
      .order("name"),
  ]);

  const version = versionRes.data as {
    id: string;
    version_number: number;
    body: string;
    available_slugs: string[] | string;
    notes: string;
    created_at: string;
  } | null;

  const binding = bindingRes.data as {
    prompt_id: string;
    primary_model_slug: string;
    fallback_1_model_slug: string | null;
    fallback_2_model_slug: string | null;
    temperature: number;
    max_tokens: number;
    response_format: string;
    json_schema: unknown;
  } | null;

  const history = (historyRes.data ?? []) as Array<{
    id: string;
    version_number: number;
    notes: string;
    created_by: string | null;
    created_at: string;
  }>;

  const models = (modelsRes.data ?? []) as ModelRow[];

  // Parse available_slugs.
  let availableSlugs: string[] = [];
  if (version?.available_slugs) {
    if (Array.isArray(version.available_slugs)) {
      availableSlugs = version.available_slugs;
    } else {
      try {
        const parsed = JSON.parse(version.available_slugs);
        availableSlugs = Array.isArray(parsed) ? parsed : [];
      } catch {
        availableSlugs = [];
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          <span className="font-mono text-accent">{slug}</span>
        </h1>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            prompt.status === "active"
              ? "bg-green-950 text-green-400"
              : "bg-surface text-faint"
          }`}
        >
          {prompt.status}
        </span>
      </div>

      {error ? (
        <p className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-green-900 bg-green-950/40 p-3 text-sm text-green-300">
          {success}
        </p>
      ) : null}

      {/* Two-panel layout (stacked on mobile) */}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Left — prompt editor */}
        <PromptEditor
          slug={slug}
          name={prompt.name}
          description={prompt.description}
          purpose={prompt.purpose}
          status={prompt.status}
          body={version?.body ?? ""}
          availableSlugs={availableSlugs}
          versionNumber={version?.version_number ?? 0}
          history={history}
        />

        {/* Right — model binding */}
        <ModelBinding
          slug={slug}
          binding={binding}
          models={models}
        />
      </div>

      {/* Test panel */}
      <TestPanel slug={slug} availableSlugs={availableSlugs} />
    </div>
  );
}
