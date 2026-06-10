import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import {
  templateById,
  templateFieldRows,
  type TemplateBucket,
} from "@/lib/diary-templates";
import type { FieldType } from "@/lib/types";
import { applyTemplate } from "@/app/settings/tracking/actions";

// Apply-a-template screen (PRD §5.9.1): a checklist the user edits before
// confirming. Core fields are pre-checked; optional and periodic (labs) are
// not. Nothing is created until "Add to diary". Reached from a medication
// (?medication_id=, scopes the fields) or the goal gallery (unscoped).

const TYPE_HINT: Record<FieldType, string> = {
  number: "number",
  scale_1_10: "1–10",
  boolean: "yes / no",
  freetext: "note",
  category: "choice",
  multiselect: "multi-choice",
};

const BUCKETS: { key: TemplateBucket; title: string; blurb: string }[] = [
  { key: "core", title: "Suggested", blurb: "Added by default — untick anything you'd rather skip." },
  { key: "optional", title: "Add if you like", blurb: "Optional extras some people find useful." },
  { key: "periodic", title: "Occasional results", blurb: "Labs & measurements — kept off the daily form; log them when you have a result." },
];

export default async function ApplyTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ medication_id?: string; error?: string }>;
}) {
  const { id } = await params;
  const { medication_id: medicationId, error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active) redirect("/dashboard");
  if (active.role !== "owner") redirect("/settings/tracking");

  const template = templateById(id);
  if (!template) notFound();

  // Existing field names → already-tracked rows are shown but not re-addable.
  const { data: existing } = await supabase
    .from("tracked_fields")
    .select("name")
    .eq("patient_id", active.id);
  const have = new Set(
    (existing ?? []).map((r) => String(r.name).trim().toLowerCase())
  );

  // Medication name for the header, when scoped to one.
  let medName: string | null = null;
  if (medicationId) {
    const { data: med } = await supabase
      .from("medications")
      .select("display_name")
      .eq("id", medicationId)
      .maybeSingle();
    medName = med?.display_name ?? null;
  }

  const rows = templateFieldRows(template).map((r, idx) => ({
    ...r,
    idx,
    already: have.has(r.preset.name.trim().toLowerCase()),
  }));

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link
            href={medicationId ? `/medications/${medicationId}` : "/settings/tracking"}
            className="text-sm text-faint hover:text-muted"
          >
            ← Cancel
          </Link>
          <span className="text-sm text-muted">{active.name}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-xl font-medium tracking-tight">{template.name}</h1>
        <p className="mt-1 text-sm text-faint">{template.description}</p>
        <p className="mt-2 text-xs text-faint">
          These are things people commonly track{medName ? <> for <span className="text-muted blur-private">{medName}</span></> : null}.
          Pick what you want — nothing is added until you confirm, and you can
          change any of it later.
        </p>

        {error ? (
          <p className="mt-4 rounded-md border alert-error p-3 text-sm">{error}</p>
        ) : null}

        <form action={applyTemplate} className="mt-6 space-y-6">
          <input type="hidden" name="template_id" value={template.id} />
          {medicationId ? (
            <input type="hidden" name="medication_id" value={medicationId} />
          ) : null}

          {BUCKETS.map((bucket) => {
            const items = rows.filter((r) => r.bucket === bucket.key);
            if (items.length === 0) return null;
            return (
              <fieldset
                key={bucket.key}
                className="space-y-2 rounded-md border border-line p-4"
              >
                <legend className="text-sm font-medium text-paper">
                  {bucket.title}
                </legend>
                <p className="text-xs text-faint">{bucket.blurb}</p>
                <ul className="mt-1 space-y-1">
                  {items.map((r) => (
                    <li key={r.idx}>
                      <label className="flex items-start gap-3 rounded px-1 py-1.5 text-sm">
                        <input
                          type="checkbox"
                          name="field"
                          value={r.idx}
                          defaultChecked={r.defaultChecked && !r.already}
                          disabled={r.already}
                          className="mt-0.5 accent-accent"
                        />
                        <span className={r.already ? "text-faint" : ""}>
                          <span className={r.already ? "" : "text-paper"}>
                            {r.preset.name}
                          </span>
                          <span className="text-faint">
                            {" · "}
                            {TYPE_HINT[r.preset.field_type]}
                            {r.preset.unit ? ` (${r.preset.unit})` : ""}
                          </span>
                          {r.already ? (
                            <span className="text-faint"> — already in your diary</span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            );
          })}

          <div className="flex gap-3">
            <button
              type="submit"
              className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
            >
              Add to diary
            </button>
            <Link
              href={medicationId ? `/medications/${medicationId}` : "/settings/tracking"}
              className="rounded-md border border-line px-4 py-2.5 text-sm text-muted transition-colors hover:bg-surface"
            >
              Not now
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
