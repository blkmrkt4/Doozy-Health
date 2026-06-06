import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

// Prompts list page (PRD §14.4.1). Shows all registered prompts with their
// slug, name, purpose, bound model, fallback count, and status.

export default async function AdminPromptsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const svc = createAdminClient();

  // Load prompts, versions, and bindings separately to avoid join-type issues.
  const [promptsRes, versionsRes, bindingsRes] = await Promise.all([
    svc
      .from("prompts")
      .select("id, slug, name, purpose, status, updated_at, current_version_id")
      .order("slug"),
    svc.from("prompt_versions").select("id, available_slugs"),
    svc.from("prompt_bindings").select("prompt_id, primary_model_slug, fallback_1_model_slug, fallback_2_model_slug"),
  ]);

  type PromptRow = {
    id: string;
    slug: string;
    name: string;
    purpose: string;
    status: string;
    updated_at: string;
    current_version_id: string | null;
  };
  type VersionRow = { id: string; available_slugs: string[] | string };
  type BindingRow = {
    prompt_id: string;
    primary_model_slug: string;
    fallback_1_model_slug: string | null;
    fallback_2_model_slug: string | null;
  };

  const promptList = (promptsRes.data ?? []) as unknown as PromptRow[];
  const versionMap = new Map(
    ((versionsRes.data ?? []) as unknown as VersionRow[]).map((v) => [v.id, v])
  );
  const bindingMap = new Map(
    ((bindingsRes.data ?? []) as unknown as BindingRow[]).map((b) => [b.prompt_id, b])
  );

  const rows = promptList.map((p) => ({
    ...p,
    prompt_versions: p.current_version_id ? versionMap.get(p.current_version_id) ?? null : null,
    prompt_bindings: bindingMap.get(p.id) ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Prompts</h1>
        <Link
          href="/admin/prompts/new"
          className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
        >
          New prompt
        </Link>
      </div>

      {error ? (
        <p className="rounded-md border alert-error p-3 text-sm">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border alert-success p-3 text-sm">
          {success}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-faint">No prompts registered.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-3 py-2">Slug</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Purpose</th>
                <th className="px-3 py-2">Variables</th>
                <th className="px-3 py-2">Primary model</th>
                <th className="px-3 py-2">FB</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((p) => {
                const slugs = parseSlugs(p.prompt_versions?.available_slugs);
                const fallbackCount =
                  (p.prompt_bindings?.fallback_1_model_slug ? 1 : 0) +
                  (p.prompt_bindings?.fallback_2_model_slug ? 1 : 0);

                return (
                  <tr key={p.slug} className="hover:bg-surface">
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/prompts/${p.slug}`}
                        className="font-mono text-xs text-accent hover:underline"
                      >
                        {p.slug}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-paper">{p.name}</td>
                    <td className="px-3 py-2 text-xs text-muted">{p.purpose}</td>
                    <td className="max-w-[180px] truncate px-3 py-2 font-mono text-xs text-faint">
                      {slugs.length > 0
                        ? slugs.map((s) => `{{${s}}}`).join(", ")
                        : "—"}
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-2 text-xs text-muted">
                      {p.prompt_bindings?.primary_model_slug ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-faint">
                      {fallbackCount > 0 ? `+${fallbackCount}` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.status === "active"
                            ? "bg-green-950 text-green-400"
                            : "bg-surface text-faint"
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function parseSlugs(raw: string[] | string | undefined | null): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
