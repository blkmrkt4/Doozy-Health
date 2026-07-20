import { formatDose, formatFrequency, formatRoute } from "@/lib/format";

// "Dose history" timeline (PRD §5.3): the versioned record of how this
// medication has actually been taken (chosen_regimens) interleaved with new
// prescriptions on record (prescribed_regimens). A factual record the user
// authored — each change is stated as from → to with their own reason note,
// never as commentary or a trend judgment (PRD §6.1).

type RegimenRow = {
  dose_amount: string;
  dose_unit: string;
  frequency: unknown;
  route: string;
  created_at: string;
  reason_note?: string | null;
  prescriber_name?: string | null;
  active?: boolean;
};

type HistoryEvent = {
  atISO: string;
  kind: "chosen_start" | "chosen_change" | "prescribed";
  text: string;
  note: string | null;
};

function summary(r: RegimenRow): string {
  return `${formatDose(r.dose_amount, r.dose_unit)} ${formatFrequency(r.frequency)} — ${formatRoute(r.route)}`;
}

function monthDayYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function buildRegimenHistory(
  chosen: RegimenRow[],
  prescribed: RegimenRow[]
): HistoryEvent[] {
  const byOldest = (rows: RegimenRow[]) =>
    [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));

  const events: HistoryEvent[] = [];

  const chosenAsc = byOldest(chosen);
  chosenAsc.forEach((row, i) => {
    if (i === 0) {
      events.push({
        atISO: row.created_at,
        kind: "chosen_start",
        text: `Started recording ${summary(row)}`,
        note: row.reason_note ?? null,
      });
    } else {
      const prev = chosenAsc[i - 1];
      events.push({
        atISO: row.created_at,
        kind: "chosen_change",
        text: `Changed from ${summary(prev)} to ${summary(row)}`,
        note: row.reason_note ?? null,
      });
    }
  });

  // The first prescription belongs to setup, not history; later ones are the
  // "new prescription recorded" entries.
  byOldest(prescribed)
    .slice(1)
    .forEach((row) => {
      events.push({
        atISO: row.created_at,
        kind: "prescribed",
        text:
          `New prescription recorded — ${summary(row)}` +
          (row.prescriber_name ? ` (${row.prescriber_name})` : ""),
        note: null,
      });
    });

  return events.sort((a, b) => b.atISO.localeCompare(a.atISO));
}

export function RegimenHistory({
  chosen,
  prescribed,
}: {
  chosen: RegimenRow[];
  prescribed: RegimenRow[];
}) {
  const events = buildRegimenHistory(chosen, prescribed);
  // Only worth a section once there is actual history beyond initial setup.
  if (events.filter((e) => e.kind !== "chosen_start").length === 0) return null;

  return (
    <section className="rounded-md border border-line p-4">
      <h2 className="text-sm font-medium text-paper">Dose history</h2>
      <ol className="mt-3 space-y-3">
        {events.map((e, i) => (
          <li key={`${e.atISO}-${i}`} className="flex gap-3 text-sm">
            <span className="w-24 shrink-0 tabular text-faint">
              {monthDayYear(e.atISO)}
            </span>
            <span className="min-w-0">
              <span className="text-muted blur-private">{e.text}</span>
              {e.note ? (
                <span className="mt-0.5 block text-xs text-faint blur-private">
                  Note: {e.note}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
