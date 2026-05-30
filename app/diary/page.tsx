import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { DiaryFields } from "@/app/medications/_components/diary-fields";
import { saveDiaryEntry, deleteDiaryEntry } from "./actions";
import { relativeAge } from "@/lib/format";

// Free-standing diary page (PRD §5.9). Record how you are feeling without
// attaching to a specific dose. Shows active tracked fields + history.

export default async function DiaryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active) redirect("/dashboard");

  const canLog = active.role === "owner" || active.role === "caregiver";

  // Load active tracked fields.
  const { data: fieldsData } = await supabase
    .from("tracked_fields")
    .select("id, name, field_type, unit, category_options")
    .eq("patient_id", active.id)
    .eq("active", true)
    .order("display_order");

  const fields = (fieldsData ?? []) as Array<{
    id: string;
    name: string;
    field_type: string;
    unit: string | null;
    category_options: string[] | null;
  }>;

  // Load recent diary entries (last 20).
  const { data: entriesData } = await supabase
    .from("diary_entries")
    .select("id, entry_at, field_values, note, attached_dose_log_id")
    .eq("patient_id", active.id)
    .order("entry_at", { ascending: false })
    .limit(20);

  const entries = (entriesData ?? []) as Array<{
    id: string;
    entry_at: string;
    field_values: Record<string, unknown>;
    note: string | null;
    attached_dose_log_id: string | null;
  }>;

  // Build a field name lookup for display.
  const fieldNameMap = new Map(fields.map((f) => [f.id, f.name]));

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link
            href="/dashboard"
            className="text-sm text-faint hover:text-muted"
          >
            ← Dashboard
          </Link>
          <span className="text-sm text-muted">{active.name}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 space-y-6">
        <h1 className="text-xl font-medium tracking-tight">Diary</h1>

        {error ? (
          <p className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        {/* Entry form */}
        {canLog ? (
          <section className="rounded-md border border-line p-4 space-y-4">
            <h2 className="text-sm font-medium text-paper">
              How are you feeling?
            </h2>

            {fields.length === 0 ? (
              <p className="text-sm text-faint">
                No tracking fields configured.{" "}
                {active.role === "owner" ? (
                  <Link
                    href="/settings/tracking"
                    className="text-accent hover:underline"
                  >
                    Set up fields
                  </Link>
                ) : null}
              </p>
            ) : (
              <form action={saveDiaryEntry} className="space-y-4">
                <input type="hidden" name="return_to" value="/diary" />
                <DiaryFields fields={fields} />
                <div>
                  <label htmlFor="note" className="block text-sm text-muted">
                    Note (optional)
                  </label>
                  <input
                    id="note"
                    name="note"
                    type="text"
                    placeholder="Anything else..."
                    className="mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90"
                >
                  Save entry
                </button>
              </form>
            )}
          </section>
        ) : null}

        {/* History */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted">Recent entries</h2>
          {entries.length === 0 ? (
            <p className="text-sm text-faint">No diary entries yet.</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {entries.map((e) => (
                <li key={e.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-faint">
                        {relativeAge(e.entry_at)}
                        {e.attached_dose_log_id ? (
                          <span className="ml-2 text-muted">(with dose)</span>
                        ) : null}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-3 text-sm">
                        {Object.entries(e.field_values).map(([fid, val]) => (
                          <span key={fid} className="text-paper">
                            <span className="text-faint">
                              {fieldNameMap.get(fid) ?? fid}:
                            </span>{" "}
                            {String(val)}
                          </span>
                        ))}
                      </div>
                      {e.note ? (
                        <p className="mt-1 text-xs text-muted">{e.note}</p>
                      ) : null}
                    </div>
                    {canLog ? (
                      <form action={deleteDiaryEntry} className="shrink-0">
                        <input type="hidden" name="entry_id" value={e.id} />
                        <input type="hidden" name="return_to" value="/diary" />
                        <button
                          type="submit"
                          className="text-xs text-faint underline hover:text-muted"
                        >
                          remove
                        </button>
                      </form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
