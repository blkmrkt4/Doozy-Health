import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

// Admin Extractions page (PRD §14.7). Shows aggregate cross-tabs of
// extraction_deltas: per field, per drug, per prompt, per model, per direction.
// Correction rates exclude deltas annotated as "expected".

type AggRow = {
  key: string;
  total: number;
  misses: number;
  rate: number;
};

function percent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export default async function AdminExtractionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    days?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const { tab = "field", days: daysRaw, error, success } = await searchParams;
  const days = Number(daysRaw) || 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const svc = createAdminClient();

  // Load all deltas in the window.
  const { data: rawDeltas } = await svc
    .from("extraction_deltas")
    .select(
      "id, field_name, drug_canonical_name, prompt_slug, prompt_version_id, " +
        "model_used, direction, admin_annotation, created_at"
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  const deltas = (rawDeltas ?? []) as unknown as Array<{
    id: string;
    field_name: string;
    drug_canonical_name: string;
    prompt_slug: string;
    prompt_version_id: string;
    model_used: string;
    direction: string;
    admin_annotation: string;
    created_at: string;
  }>;

  // Build aggregates. "expected" deltas are excluded from the miss count.
  function aggregate(keyFn: (d: (typeof deltas)[0]) => string): AggRow[] {
    const map = new Map<string, { total: number; misses: number }>();
    for (const d of deltas) {
      const key = keyFn(d);
      const entry = map.get(key) ?? { total: 0, misses: 0 };
      entry.total++;
      if (d.admin_annotation !== "expected") {
        entry.misses++;
      }
      map.set(key, entry);
    }
    return [...map.entries()]
      .map(([key, { total, misses }]) => ({
        key,
        total,
        misses,
        rate: total > 0 ? misses / total : 0,
      }))
      .sort((a, b) => b.rate - a.rate);
  }

  const tabs = [
    { id: "field", label: "Per field" },
    { id: "drug", label: "Per drug" },
    { id: "prompt", label: "Per prompt" },
    { id: "model", label: "Per model" },
    { id: "direction", label: "Per direction" },
  ] as const;

  let rows: AggRow[] = [];
  let drillPrefix = "";
  switch (tab) {
    case "drug":
      rows = aggregate((d) => d.drug_canonical_name);
      drillPrefix = "drug:";
      break;
    case "prompt":
      rows = aggregate((d) => `${d.prompt_slug} v${d.prompt_version_id.slice(0, 8)}`);
      drillPrefix = "prompt:";
      break;
    case "model":
      rows = aggregate((d) => d.model_used);
      drillPrefix = "model:";
      break;
    case "direction":
      rows = aggregate((d) => d.direction);
      drillPrefix = "direction:";
      break;
    default:
      rows = aggregate((d) => d.field_name);
      drillPrefix = "field:";
  }

  // Direction summary.
  const llmToUser = deltas.filter((d) => d.direction === "llm_to_user").length;
  const userToLlm = deltas.filter((d) => d.direction === "user_to_llm").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Extractions</h1>
        <div className="flex items-center gap-3 text-sm text-muted">
          <span>Window:</span>
          {[30, 90].map((d) => (
            <Link
              key={d}
              href={`/admin/extractions?tab=${tab}&days=${d}`}
              className={`rounded px-2 py-0.5 ${
                days === d ? "bg-surface text-paper" : "hover:text-paper"
              }`}
            >
              {d}d
            </Link>
          ))}
        </div>
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

      {/* Summary stats */}
      <div className="flex gap-6 text-sm">
        <span className="text-muted">
          <span className="tabular text-paper">{deltas.length}</span> total
          deltas
        </span>
        <span className="text-muted">
          <span className="tabular text-paper">{llmToUser}</span> llm→user
        </span>
        <span className="text-muted">
          <span className="tabular text-paper">{userToLlm}</span> user→llm
        </span>
      </div>

      {/* Tab navigation */}
      <nav className="flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={`/admin/extractions?tab=${t.id}&days=${days}`}
            className={`border-b-2 px-3 py-2 text-sm ${
              tab === t.id
                ? "border-accent text-paper"
                : "border-transparent text-muted hover:text-paper"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {/* Aggregate table */}
      {rows.length === 0 ? (
        <p className="text-sm text-faint">
          No extraction deltas in the last {days} days.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-3 py-2">
                  {tab === "field"
                    ? "Field"
                    : tab === "drug"
                      ? "Drug"
                      : tab === "prompt"
                        ? "Prompt x version"
                        : tab === "model"
                          ? "Model"
                          : "Direction"}
                </th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Corrections</th>
                <th className="px-3 py-2 text-right">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-surface">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/extractions/${encodeURIComponent(drillPrefix + r.key)}?days=${days}`}
                      className="text-accent hover:underline"
                    >
                      {r.key}
                    </Link>
                  </td>
                  <td className="tabular px-3 py-2 text-right">{r.total}</td>
                  <td className="tabular px-3 py-2 text-right">{r.misses}</td>
                  <td className="tabular px-3 py-2 text-right">
                    <span
                      className={
                        r.rate > 0.3
                          ? "text-red-400"
                          : r.rate > 0.1
                            ? "text-yellow-400"
                            : "text-green-400"
                      }
                    >
                      {percent(r.rate)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
