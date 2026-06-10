import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import {
  createTrackedField,
  updateTrackedField,
  deleteTrackedField,
  updatePatientDemographics,
} from "./actions";
import { DIARY_PRESETS } from "@/lib/diary-presets";
import { FIELD_TYPE_LABELS, type FieldType, type PatientSex } from "@/lib/types";
import {
  galleryTemplates,
  ageFromDob,
  type DiaryTemplate,
} from "@/lib/diary-templates";
import { TrackedFieldForm } from "./tracked-field-form";

// Tracked fields settings page (PRD §5.9, §13.15). Owner-only.
// Configure per-patient custom tracking fields (mood, sleep, pain, etc.).

export default async function TrackingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active || active.role !== "owner") redirect("/dashboard");

  const { data: fields } = await supabase
    .from("tracked_fields")
    .select("id, name, field_type, unit, category_options, active, display_order")
    .eq("patient_id", active.id)
    .order("display_order");

  const trackedFields = (fields ?? []) as Array<{
    id: string;
    name: string;
    field_type: string;
    unit: string | null;
    category_options: string[] | null;
    active: boolean;
    display_order: number;
  }>;

  // Medications (for the "applies to" picker + field tags) and the scope links.
  const { data: medRows } = await supabase
    .from("medications")
    .select("id, display_name")
    .eq("patient_id", active.id)
    .eq("archived", false)
    .order("created_at");
  const meds = (medRows ?? []) as { id: string; display_name: string }[];
  const medNameById = new Map(meds.map((m) => [m.id, m.display_name]));

  const { data: tfmRows } = await supabase
    .from("tracked_field_medications")
    .select("tracked_field_id, medication_id");
  const tagsByField = new Map<string, string[]>();
  for (const r of (tfmRows ?? []) as { tracked_field_id: string; medication_id: string }[]) {
    const nm = medNameById.get(r.medication_id);
    if (!nm) continue;
    const arr = tagsByField.get(r.tracked_field_id) ?? [];
    arr.push(nm);
    tagsByField.set(r.tracked_field_id, arr);
  }

  // Patient demographics drive which templates are suggested (visibility only).
  const { data: patient } = await supabase
    .from("patients")
    .select("sex, date_of_birth")
    .eq("id", active.id)
    .maybeSingle();
  const sex = (patient?.sex ?? null) as PatientSex | null;
  const dob = (patient?.date_of_birth ?? null) as string | null;
  const gallery = galleryTemplates({ sex, age: ageFromDob(dob, Date.now()) });
  const galleryByKind: Record<DiaryTemplate["kind"], DiaryTemplate[]> = {
    medication: gallery.filter((t) => t.kind === "medication"),
    goal: gallery.filter((t) => t.kind === "goal"),
    care: gallery.filter((t) => t.kind === "care"),
  };
  const KIND_TITLES: Record<DiaryTemplate["kind"], string> = {
    goal: "By goal",
    medication: "By medication type",
    care: "Caring for someone",
  };

  // Library grouped in display order, hiding presets already added (by name).
  const existingNames = new Set(
    trackedFields.map((f) => f.name.trim().toLowerCase())
  );
  const libraryGroups: string[] = [];
  for (const p of DIARY_PRESETS) {
    if (!libraryGroups.includes(p.group)) libraryGroups.push(p.group);
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link
            href="/settings"
            className="text-sm text-faint hover:text-muted"
          >
            ← Settings
          </Link>
          <span className="text-sm text-muted">{active.name}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 space-y-6">
        <h1 className="text-xl font-medium tracking-tight">Diary tracking fields</h1>
        <p className="text-sm text-faint">
          Choose what to track in your diary — mood, sleep, symptoms, or anything
          else. No defaults are imposed.
        </p>

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

        {/* Templates gallery — "What are you trying to understand?" Each card
            opens the select-&-confirm screen (unscoped from here). */}
        <section className="rounded-md border border-line p-4 space-y-4">
          <div>
            <h2 className="text-sm font-medium text-paper">
              Start from a template
            </h2>
            <p className="mt-0.5 text-xs text-faint">
              Curated sets of fields people commonly track. Pick one to start —
              you choose what to keep before anything is added.
            </p>
          </div>

          {(Object.keys(galleryByKind) as DiaryTemplate["kind"][]).map((kind) => {
            const items = galleryByKind[kind];
            if (items.length === 0) return null;
            return (
              <div key={kind}>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-faint">
                  {KIND_TITLES[kind]}
                </p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {items.map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/settings/tracking/templates/${t.id}`}
                        className="block h-full rounded-md border border-line p-3 transition-colors hover:bg-surface"
                      >
                        <p className="text-sm font-medium text-paper">{t.name}</p>
                        <p className="mt-0.5 text-xs text-faint">{t.description}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          {/* About this patient — sex/age tune which templates show. Optional. */}
          <details className="rounded-md border border-line">
            <summary className="cursor-pointer list-none px-3 py-2 text-xs text-accent hover:underline">
              About this patient — tune which templates show
            </summary>
            <form
              action={updatePatientDemographics}
              className="space-y-3 border-t border-line p-3"
            >
              <p className="text-xs text-faint">
                Used only to suggest relevant templates — nothing is auto-added,
                and sex-specific sets stay reachable from the full list either way.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm text-muted">
                  Sex
                  <select
                    name="sex"
                    defaultValue={sex ?? ""}
                    className="mt-1 block w-40 rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent"
                  >
                    <option value="">Prefer not to say</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                </label>
                <label className="text-sm text-muted">
                  Date of birth
                  <input
                    type="date"
                    name="date_of_birth"
                    defaultValue={dob ?? ""}
                    className="mt-1 block w-44 rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-md border border-line px-3 py-2 text-sm text-muted transition-colors hover:bg-surface"
                >
                  Save
                </button>
              </div>
            </form>
          </details>
        </section>

        {/* Current fields */}
        <section className="rounded-md border border-line p-4 space-y-3">
          <h2 className="text-sm font-medium text-paper">Your fields</h2>

          {/* Add your own — opens as a twisty at the top of the list. */}
          <details className="rounded-md border border-line">
            <summary className="cursor-pointer list-none px-3 py-2 text-sm text-accent hover:underline">
              + Add your own
            </summary>
            <div className="border-t border-line p-3">
              <TrackedFieldForm meds={meds} />
            </div>
          </details>

          {trackedFields.length === 0 ? (
            <p className="text-sm text-faint">No fields configured yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {trackedFields.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm ${f.active ? "text-paper" : "text-faint line-through"}`}
                    >
                      {f.name}
                      {f.unit ? (
                        <span className="ml-1 text-xs text-faint">
                          ({f.unit})
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-faint">
                      {f.field_type.replace("_", " ")}
                      {f.category_options
                        ? `: ${(f.category_options as string[]).join(", ")}`
                        : null}
                    </p>
                    <p className="text-[11px] text-faint">
                      {tagsByField.get(f.id)?.length
                        ? `for: ${tagsByField.get(f.id)!.join(", ")}`
                        : "all medications"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <form action={updateTrackedField}>
                      <input type="hidden" name="field_id" value={f.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={f.active ? "false" : "true"}
                      />
                      <button
                        type="submit"
                        className="text-xs text-muted underline hover:text-paper"
                      >
                        {f.active ? "disable" : "enable"}
                      </button>
                    </form>
                    <form action={deleteTrackedField}>
                      <input type="hidden" name="field_id" value={f.id} />
                      <button
                        type="submit"
                        className="text-xs text-faint underline hover:text-red-400"
                      >
                        remove
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Library — one row per field, grouped; "Add" to start tracking it. */}
        <section className="rounded-md border border-line p-4 space-y-4">
          <h2 className="text-sm font-medium text-paper">Add from the library</h2>
          {libraryGroups.map((group) => {
            const items = DIARY_PRESETS.filter(
              (p) => p.group === group && !existingNames.has(p.name.toLowerCase())
            );
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-faint">
                  {group}
                </p>
                <ul className="divide-y divide-line">
                  {items.map((p) => (
                    <li
                      key={p.name}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-paper">{p.name}</p>
                        <p className="text-xs text-faint">
                          {FIELD_TYPE_LABELS[p.field_type as FieldType]}
                          {p.unit ? ` · ${p.unit}` : ""}
                          {p.category_options
                            ? `: ${p.category_options.join(", ")}`
                            : ""}
                        </p>
                      </div>
                      <form action={createTrackedField} className="shrink-0">
                        <input type="hidden" name="name" value={p.name} />
                        <input type="hidden" name="field_type" value={p.field_type} />
                        {p.unit ? <input type="hidden" name="unit" value={p.unit} /> : null}
                        {p.category_options ? (
                          <input
                            type="hidden"
                            name="category_options"
                            value={p.category_options.join(", ")}
                          />
                        ) : null}
                        <button
                          type="submit"
                          className="rounded-md border border-line px-3 py-1 text-xs text-muted transition-colors hover:bg-surface"
                        >
                          Add
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}
