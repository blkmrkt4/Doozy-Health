import { createAdminClient } from "@/lib/supabase/admin";
import { SettingsForms } from "./settings-forms";

// Admin Settings page (PRD §14.3). Loads server-side data and renders
// client forms for API key, default models, model catalogue, and recent calls.

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const svc = createAdminClient();

  // Load all data in parallel.
  const [settingsRes, secretRes, modelsRes, logsRes] = await Promise.all([
    svc.from("system_settings").select("*").single(),
    svc
      .from("system_secrets")
      .select("value_masked, updated_at")
      .eq("key", "openrouter_api_key")
      .maybeSingle(),
    svc
      .from("openrouter_models")
      .select("slug, name, provider, context_length, input_cost_per_mtoken, output_cost_per_mtoken, supports_vision, supports_tools, supports_json_mode, is_coding_specialist, is_reasoning_specialist, is_available, last_synced_at")
      .order("name"),
    svc
      .from("llm_call_logs")
      .select("id, prompt_slug, model_used, was_fallback, latency_ms, input_tokens, output_tokens, success, error_message, was_test, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const settings = settingsRes.data;
  const secret = secretRes.data;
  const models = (modelsRes.data ?? []) as Array<{
    slug: string;
    name: string;
    provider: string;
    context_length: number | null;
    input_cost_per_mtoken: number | null;
    output_cost_per_mtoken: number | null;
    supports_vision: boolean;
    supports_tools: boolean;
    supports_json_mode: boolean;
    is_coding_specialist: boolean;
    is_reasoning_specialist: boolean;
    is_available: boolean;
    last_synced_at: string;
  }>;
  const logs = (logsRes.data ?? []) as Array<{
    id: string;
    prompt_slug: string;
    model_used: string;
    was_fallback: number;
    latency_ms: number;
    input_tokens: number | null;
    output_tokens: number | null;
    success: boolean;
    error_message: string | null;
    was_test: boolean;
    created_at: string;
  }>;

  const availableCount = models.filter((m) => m.is_available).length;
  const lastSynced = models[0]?.last_synced_at ?? null;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

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

      <SettingsForms
        apiKeyMasked={secret?.value_masked ?? null}
        apiKeyUpdatedAt={secret?.updated_at ?? null}
        defaultPrimary={settings?.default_primary_model_slug ?? ""}
        defaultFallback1={settings?.default_fallback_1_model_slug ?? ""}
        defaultFallback2={settings?.default_fallback_2_model_slug ?? ""}
        models={models}
        availableCount={availableCount}
        totalCount={models.length}
        lastSynced={lastSynced}
      />

      {/* Recent calls — server-rendered table */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Recent calls</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-faint">No calls logged yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">Slug</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">FB</th>
                  <th className="px-3 py-2 text-right">Latency</th>
                  <th className="px-3 py-2 text-right">Tokens</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    className={log.was_test ? "bg-surface" : ""}
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {log.prompt_slug}
                      {log.was_test ? (
                        <span className="ml-1 text-faint">(test)</span>
                      ) : null}
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-xs text-muted">
                      {log.model_used}
                    </td>
                    <td className="px-3 py-2 text-xs text-faint">
                      {log.was_fallback > 0 ? `FB${log.was_fallback}` : "—"}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-xs">
                      {log.latency_ms}ms
                    </td>
                    <td className="tabular px-3 py-2 text-right text-xs text-muted">
                      {log.input_tokens ?? "—"}/{log.output_tokens ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {log.success ? (
                        <span className="text-green-400">OK</span>
                      ) : (
                        <span
                          className="text-red-400"
                          title={log.error_message ?? ""}
                        >
                          Fail
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-faint">
                      {new Date(log.created_at).toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
