import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  computeConcentration,
  resolveParams,
  generateScheduledDoses,
  type DoseEvent,
} from "@/lib/pharmacokinetics";
import { PkChart } from "./pk-chart";

// Pharmacokinetic timeline page (PRD §4.4, §5.7, §13.11).
// Deterministic — no LLM (CLAUDE.md hard rule #8).
// Shows modelled concentration over past 14 days + projected next 7.

const MS_PER_HOUR = 3_600_000;
const DAY_MS = 24 * MS_PER_HOUR;
const PAST_DAYS = 14;
const FUTURE_DAYS = 7;

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: medicationId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Load medication with drug link.
  const { data: med } = await supabase
    .from("medications")
    .select("id, display_name, canonical_drug_id, patient_id")
    .eq("id", medicationId)
    .single();
  if (!med) notFound();

  // Load the active chosen regimen (dose + route + frequency).
  const { data: chosenRaw } = await supabase
    .from("chosen_regimens")
    .select("dose_amount, dose_unit, route, frequency")
    .eq("medication_id", medicationId)
    .eq("active", true)
    .single();

  const chosen = chosenRaw as {
    dose_amount: string;
    dose_unit: string;
    route: string;
    frequency: unknown;
  } | null;

  if (!chosen) notFound();

  // Load drug PK params.
  let pkParams = null;
  if (med.canonical_drug_id) {
    const { data: drug } = await supabase
      .from("drugs")
      .select("half_life_hours, bioavailability, tmax_hours")
      .eq("id", med.canonical_drug_id)
      .single();

    if (drug) {
      pkParams = resolveParams(
        drug as {
          half_life_hours: Record<string, number>;
          bioavailability?: Record<string, number>;
          tmax_hours?: Record<string, number>;
        },
        chosen.route
      );
    }
  }

  if (!pkParams) {
    return (
      <div className="min-h-full">
        <Header medicationId={medicationId} name={med.display_name} />
        <main className="mx-auto max-w-2xl px-6 py-10">
          <h1 className="text-xl font-medium tracking-tight">
            {med.display_name} — Timeline
          </h1>
          <p className="mt-4 text-sm text-faint">
            No pharmacokinetic data available for this medication and route.
            The drug must be linked to a reference entry with half-life data
            for the {chosen.route} route.
          </p>
        </main>
      </div>
    );
  }

  // Load dose logs for the past 14 days.
  const now = Date.now();
  const rangeStart = now - PAST_DAYS * DAY_MS;
  const rangeEnd = now + FUTURE_DAYS * DAY_MS;
  const lookbackSince = new Date(rangeStart).toISOString();

  const { data: logs } = await supabase
    .from("dose_logs")
    .select("logged_at, amount, event_type")
    .eq("medication_id", medicationId)
    .gte("logged_at", lookbackSince)
    .in("event_type", ["taken", "prn"])
    .order("logged_at", { ascending: true });

  const doseEvents: DoseEvent[] = (logs ?? [])
    .filter((l) => l.amount)
    .map((l) => ({
      timestamp: new Date(l.logged_at as string).getTime(),
      amount: Number(l.amount),
    }));

  // Compute the actual concentration series.
  const actualSeries = computeConcentration(
    doseEvents,
    pkParams,
    rangeStart,
    rangeEnd,
    now
  );

  // Compute a prescribed regimen overlay if available.
  const { data: prescribedRaw } = await supabase
    .from("prescribed_regimens")
    .select("dose_amount, frequency")
    .eq("medication_id", medicationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  let overlaySeries = undefined;
  if (prescribedRaw) {
    const freq = prescribedRaw.frequency as {
      type: string;
      interval?: number;
      unit?: string;
      count?: number;
      period?: string;
    };
    const scheduledDoses = generateScheduledDoses(
      freq,
      Number(prescribedRaw.dose_amount),
      rangeStart,
      rangeEnd
    );
    if (scheduledDoses.length > 0) {
      overlaySeries = computeConcentration(
        scheduledDoses,
        pkParams,
        rangeStart,
        rangeEnd,
        now
      );
    }
  }

  return (
    <div className="min-h-full">
      <Header medicationId={medicationId} name={med.display_name} />

      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-xl font-medium tracking-tight">
          {med.display_name} — Timeline
        </h1>
        <p className="mt-1 text-sm text-faint">
          Modelled concentration over the past {PAST_DAYS} days and projected
          next {FUTURE_DAYS} days, based on your dose history and the drug's
          textbook half-life.
        </p>

        <div className="mt-6">
          <PkChart series={actualSeries} overlay={overlaySeries} />
        </div>

        {/* Permanent disclaimer (PRD §5.7, §6.1) */}
        <p className="mt-4 rounded-md border border-line bg-surface p-3 text-xs text-faint">
          Based on textbook half-life. Your body may vary. Not medical advice.
        </p>

        {/* Summary stats */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Stat
            label="Doses in window"
            value={String(doseEvents.length)}
          />
          <Stat
            label="Half-life"
            value={`${pkParams.halfLifeHours}h`}
          />
          <Stat
            label="Bioavailability"
            value={`${(pkParams.bioavailability * 100).toFixed(0)}%`}
          />
        </div>
      </main>
    </div>
  );
}

function Header({
  medicationId,
  name,
}: {
  medicationId: string;
  name: string;
}) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
        <Link
          href={`/medications/${medicationId}`}
          className="text-sm text-faint hover:text-muted"
        >
          ← {name}
        </Link>
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line p-3">
      <p className="text-xs text-faint">{label}</p>
      <p className="tabular mt-1 text-lg font-medium text-paper">{value}</p>
    </div>
  );
}
