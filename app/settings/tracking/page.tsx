import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import {
  createTrackedField,
  updateTrackedField,
  deleteTrackedField,
} from "./actions";

// Tracked fields settings page (PRD §5.9, §13.15). Owner-only.
// Configure per-patient custom tracking fields (mood, sleep, pain, etc.).

const FIELD_TYPES = [
  { value: "scale_1_10", label: "Scale (1–10)" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / No" },
  { value: "freetext", label: "Free text" },
  { value: "category", label: "Category" },
] as const;

const inputCls =
  "block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent";

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
        <h1 className="text-xl font-medium tracking-tight">Tracking fields</h1>
        <p className="text-sm text-faint">
          Configure what you want to track alongside your doses — mood, sleep,
          symptoms, or anything else. No defaults are imposed.
        </p>

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

        {/* Current fields */}
        <section className="rounded-md border border-line p-4 space-y-3">
          <h2 className="text-sm font-medium text-paper">Your fields</h2>
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

        {/* Add field form */}
        <section className="rounded-md border border-line p-4 space-y-3">
          <h2 className="text-sm font-medium text-paper">Add a field</h2>
          <form action={createTrackedField} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="name" className="block text-sm text-muted">
                  Name
                </label>
                <input
                  id="name"
                  name="name"
                  required
                  placeholder="e.g. Mood, Sleep, Pain"
                  className={`${inputCls} mt-1`}
                />
              </div>
              <div>
                <label htmlFor="field_type" className="block text-sm text-muted">
                  Type
                </label>
                <select
                  id="field_type"
                  name="field_type"
                  defaultValue="scale_1_10"
                  className={`${inputCls} mt-1`}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="unit" className="block text-sm text-muted">
                  Unit (optional)
                </label>
                <input
                  id="unit"
                  name="unit"
                  placeholder="e.g. hours, mg"
                  className={`${inputCls} mt-1`}
                />
              </div>
              <div>
                <label
                  htmlFor="category_options"
                  className="block text-sm text-muted"
                >
                  Category options (comma-separated)
                </label>
                <input
                  id="category_options"
                  name="category_options"
                  placeholder="e.g. Tension, Migraine, Cluster"
                  className={`${inputCls} mt-1`}
                />
              </div>
            </div>
            <button
              type="submit"
              className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90"
            >
              Add field
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
