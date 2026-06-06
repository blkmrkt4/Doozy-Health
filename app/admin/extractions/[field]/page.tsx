import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { annotateExtraction } from "../actions";
import { ViewSourceButton } from "./view-source-button";

// Delta drill-in page (PRD §14.7). Shows the underlying extraction_deltas
// for a given aggregate key. Supports annotation and audit-logged view source.

export default async function ExtractionDrillInPage({
  params,
  searchParams,
}: {
  params: Promise<{ field: string }>;
  searchParams: Promise<{ days?: string; error?: string }>;
}) {
  const { field: rawField } = await params;
  const { days: daysRaw, error } = await searchParams;
  const field = decodeURIComponent(rawField);
  const days = Number(daysRaw) || 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // Parse "type:value" format.
  const colonIdx = field.indexOf(":");
  const filterType = colonIdx > -1 ? field.slice(0, colonIdx) : "field";
  const filterValue = colonIdx > -1 ? field.slice(colonIdx + 1) : field;

  const svc = createAdminClient();

  // Build the query with the appropriate filter.
  let query = svc
    .from("extraction_deltas")
    .select(
      "id, field_name, drug_canonical_name, llm_value, user_value, direction, " +
        "llm_confidence, model_used, prompt_slug, admin_annotation, document_id, created_at"
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  switch (filterType) {
    case "field":
      query = query.eq("field_name", filterValue);
      break;
    case "drug":
      query = query.eq("drug_canonical_name", filterValue);
      break;
    case "model":
      query = query.eq("model_used", filterValue);
      break;
    case "direction":
      query = query.eq("direction", filterValue);
      break;
    case "prompt":
      // "slug vXXXX" format — filter by prompt_slug.
      const slug = filterValue.split(" ")[0];
      query = query.eq("prompt_slug", slug);
      break;
  }

  const { data: rawDeltas } = await query.limit(200);

  const deltas = (rawDeltas ?? []) as unknown as Array<{
    id: string;
    field_name: string;
    drug_canonical_name: string;
    llm_value: string;
    user_value: string;
    direction: string;
    llm_confidence: string | null;
    model_used: string;
    prompt_slug: string;
    admin_annotation: string;
    document_id: string | null;
    created_at: string;
  }>;

  const returnPath = `/admin/extractions/${encodeURIComponent(field)}?days=${days}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/admin/extractions?tab=${filterType}&days=${days}`}
          className="text-sm text-faint hover:text-muted"
        >
          ← Back
        </Link>
        <h1 className="text-xl font-semibold">{filterValue}</h1>
        <span className="text-sm text-muted">
          {deltas.length} delta{deltas.length !== 1 ? "s" : ""} in {days}d
        </span>
      </div>

      {error ? (
        <p className="rounded-md border alert-error p-3 text-sm">
          {error}
        </p>
      ) : null}

      {deltas.length === 0 ? (
        <p className="text-sm text-faint">No deltas found.</p>
      ) : (
        <div className="space-y-3">
          {deltas.map((d) => (
            <div
              key={d.id}
              className={`rounded-md border p-4 ${
                d.admin_annotation === "expected"
                  ? "border-green-900/40 bg-green-950/10"
                  : d.admin_annotation === "extraction_miss"
                    ? "border-red-900/40 bg-red-950/10"
                    : "border-line"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 text-xs text-faint">
                    <span className="font-mono">{d.field_name}</span>
                    <span>·</span>
                    <span>{d.direction}</span>
                    <span>·</span>
                    <span>{d.model_used.split("/").pop()}</span>
                    {d.llm_confidence ? (
                      <>
                        <span>·</span>
                        <span
                          className={
                            d.llm_confidence === "high"
                              ? "text-green-400"
                              : d.llm_confidence === "medium"
                                ? "text-yellow-400"
                                : "text-red-400"
                          }
                        >
                          {d.llm_confidence}
                        </span>
                      </>
                    ) : null}
                  </div>

                  <div className="grid gap-1 text-sm sm:grid-cols-2">
                    <div>
                      <span className="text-xs text-faint">LLM: </span>
                      <span className="text-muted">
                        {d.llm_value || "(empty)"}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-faint">User: </span>
                      <span className="text-paper">
                        {d.user_value || "(empty)"}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-faint">
                    {d.drug_canonical_name} ·{" "}
                    {new Date(d.created_at).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 flex-col gap-1">
                  {/* Annotation buttons */}
                  <div className="flex gap-1">
                    {(["expected", "extraction_miss", "unreviewed"] as const).map(
                      (a) => (
                        <form key={a} action={annotateExtraction}>
                          <input type="hidden" name="delta_id" value={d.id} />
                          <input type="hidden" name="annotation" value={a} />
                          <input
                            type="hidden"
                            name="return_path"
                            value={returnPath}
                          />
                          <button
                            type="submit"
                            disabled={d.admin_annotation === a}
                            className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                              d.admin_annotation === a
                                ? a === "expected"
                                  ? "bg-green-950 text-green-400"
                                  : a === "extraction_miss"
                                    ? "bg-red-950 text-red-400"
                                    : "bg-surface text-faint"
                                : "bg-surface text-muted hover:text-paper"
                            } disabled:cursor-default`}
                          >
                            {a === "extraction_miss" ? "miss" : a}
                          </button>
                        </form>
                      )
                    )}
                  </div>

                  {/* View source */}
                  {d.document_id ? (
                    <ViewSourceButton
                      deltaId={d.id}
                      documentId={d.document_id}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
