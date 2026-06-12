import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { buildTrends, type TrendEntry } from "@/lib/diary-trends";
import { isFieldType, type FieldType, type DiaryFieldValue } from "@/lib/types";
import {
  NumericChart,
  BooleanStrip,
  DistributionBars,
} from "./_components/field-charts";

// Diary summary page (PRD §5.9). Day-to-day logging happens on the dashboard
// calendar's per-day Diary twisty; this page shows what's changing over time —
// a chart and a range for each tracked field. A factual record of what was
// logged, never advice. American English.

const WINDOW_DAYS = 90;

function tidy(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d} ${months[(m ?? 1) - 1] ?? ""}`;
}

export default async function DiaryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const active = await getActivePatient(supabase);
  if (!active) redirect("/dashboard");

  // Active tracked fields, in display order.
  const { data: fieldsData } = await supabase
    .from("tracked_fields")
    .select("id, name, field_type, unit, category_options")
    .eq("patient_id", active.id)
    .eq("active", true)
    .order("display_order");

  const fields = (fieldsData ?? [])
    .filter((f) => isFieldType(f.field_type as string))
    .map((f) => ({
      id: f.id as string,
      name: f.name as string,
      field_type: f.field_type as FieldType,
      unit: (f.unit as string | null) ?? null,
      category_options: (f.category_options as string[] | null) ?? null,
    }));

  // Diary entries over the trailing window — daily (entry_date) and any older
  // ad-hoc entries both carry entry_at, so we filter on that and derive the day.
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const { data: entriesData } = await supabase
    .from("diary_entries")
    .select("entry_at, entry_date, field_values, note")
    .eq("patient_id", active.id)
    .gte("entry_at", cutoff)
    .order("entry_at", { ascending: true });

  const rows = (entriesData ?? []) as Array<{
    entry_at: string;
    entry_date: string | null;
    field_values: Record<string, DiaryFieldValue>;
    note: string | null;
  }>;

  const entries: TrendEntry[] = rows.map((r) => ({
    date: r.entry_date ?? r.entry_at.slice(0, 10),
    field_values: r.field_values ?? {},
  }));

  const trends = buildTrends(fields, entries);
  const hasData = trends.some((t) => t.trend.kind !== "empty");

  // Recent notes (most recent first), independent of any field.
  const recentNotes = rows
    .filter((r) => r.note && r.note.trim())
    .map((r) => ({
      date: r.entry_date ?? r.entry_at.slice(0, 10),
      note: r.note as string,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 10);

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-sm text-faint hover:text-muted">
            ← Dashboard
          </Link>
          <span className="text-sm text-muted">{active.name}</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-medium tracking-tight">Diary</h1>
            <p className="mt-1 text-sm text-faint">
              What you&rsquo;ve logged over the last {WINDOW_DAYS} days. Log each
              day from the dashboard calendar.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/report"
              className="rounded-md border border-accent px-3 py-1.5 text-sm font-medium text-accent transition-opacity hover:opacity-90"
            >
              Create snapshot
            </Link>
            {active.role === "owner" ? (
              <Link
                href="/settings/tracking"
                className="rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface"
              >
                Modify diary
              </Link>
            ) : null}
          </div>
        </div>

        {fields.length === 0 ? (
          <p className="rounded-md border border-line p-6 text-center text-sm text-faint">
            No tracking fields configured yet.{" "}
            {active.role === "owner" ? (
              <Link href="/settings/tracking" className="text-accent hover:underline">
                Set up fields
              </Link>
            ) : null}
          </p>
        ) : !hasData ? (
          <p className="rounded-md border border-line p-6 text-center text-sm text-faint">
            Nothing logged yet. Open a day on the dashboard calendar and tap the
            Diary section to start recording.
          </p>
        ) : (
          <section className="space-y-4">
            {trends.map(({ field, trend }) => {
              const unit = field.unit ? ` ${field.unit}` : "";
              return (
                <article
                  key={field.id}
                  className="rounded-md border border-line p-4 space-y-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-sm font-medium text-paper">
                      {field.name}
                      {field.unit ? (
                        <span className="ml-1 text-xs text-faint">
                          ({field.unit})
                        </span>
                      ) : null}
                    </h2>
                    {trend.kind === "numeric" ? (
                      <p className="text-xs tabular text-muted">
                        <span className="text-paper">{tidy(trend.latest)}{unit}</span>
                        <span className="text-faint">
                          {" "}
                          · range {tidy(trend.min)}–{tidy(trend.max)} · avg{" "}
                          {tidy(trend.avg)}
                        </span>
                      </p>
                    ) : trend.kind === "boolean" ? (
                      <p className="text-xs tabular text-muted">
                        Yes on{" "}
                        <span className="text-paper">
                          {trend.yes} of {trend.total}
                        </span>{" "}
                        days
                      </p>
                    ) : trend.kind === "distribution" ? (
                      <p className="text-xs tabular text-faint">
                        {trend.total} days logged
                      </p>
                    ) : null}
                  </div>

                  {trend.kind === "numeric" ? (
                    <NumericChart
                      points={trend.points}
                      yMin={field.field_type === "scale_1_10" ? 1 : undefined}
                      yMax={field.field_type === "scale_1_10" ? 10 : undefined}
                    />
                  ) : trend.kind === "boolean" ? (
                    <BooleanStrip points={trend.points} />
                  ) : trend.kind === "distribution" ? (
                    <DistributionBars counts={trend.counts} total={trend.total} />
                  ) : trend.kind === "text" ? (
                    <ul className="space-y-1.5">
                      {trend.recent.map((r, i) => (
                        <li key={i} className="text-sm text-paper">
                          <span className="mr-2 text-xs text-faint tabular">
                            {shortDate(r.date)}
                          </span>
                          {r.text}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-faint">Nothing logged yet.</p>
                  )}
                </article>
              );
            })}
          </section>
        )}

        {/* Day notes journal */}
        {recentNotes.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted">Recent notes</h2>
            <ul className="divide-y divide-line rounded-md border border-line">
              {recentNotes.map((n, i) => (
                <li key={i} className="px-4 py-3">
                  <p className="text-xs text-faint tabular">{shortDate(n.date)}</p>
                  <p className="mt-0.5 text-sm text-paper">{n.note}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
