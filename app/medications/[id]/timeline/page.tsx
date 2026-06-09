import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  computeConcentration,
  resolveParams,
  generateScheduledDoses,
  calibrateHalfLife,
  type DoseEvent,
  type CalibrationReading,
} from "@/lib/pharmacokinetics";
import { PkChart, NonLinearPanel } from "./pk-chart";
import {
  provenanceFromReferenceData,
  type DrugPK,
} from "@/lib/pk/amountInSystem";

// Pharmacokinetic timeline page (PRD §4.4, §5.7, §13.11).
// v0.4: linearity gate, uncertainty band, metabolites, steady-state,
// personal calibration, regimen explorer link.
// Deterministic — no LLM (CLAUDE.md hard rule #8).

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

  const { data: med } = await supabase
    .from("medications")
    .select("id, display_name, canonical_drug_id, patient_id")
    .eq("id", medicationId)
    .single();
  if (!med) notFound();

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

  // Load drug PK params (v0.4: includes kernel, range, metabolites, linearity).
  let pkParams = null;
  let pkProvenance: DrugPK["provenance"] = "curated";
  if (med.canonical_drug_id) {
    const { data: drug } = await supabase
      .from("drugs")
      .select(
        "half_life_hours, half_life_range_hours, bioavailability, tmax_hours, " +
          "kernel_by_route, release_duration_hours, is_linear, nonlinear_reason, metabolites, reference_data"
      )
      .eq("id", med.canonical_drug_id)
      .single();

    pkProvenance = provenanceFromReferenceData(
      (drug as { reference_data?: unknown } | null)?.reference_data
    );
    if (drug) {
      pkParams = resolveParams(
        drug as unknown as {
          half_life_hours: Record<string, number>;
          half_life_range_hours?: Record<string, [number, number]>;
          bioavailability?: Record<string, number>;
          tmax_hours?: Record<string, number>;
          kernel_by_route?: Record<string, string>;
          release_duration_hours?: Record<string, number>;
          is_linear?: boolean;
          nonlinear_reason?: string;
          metabolites?: Array<{
            name: string;
            fraction: number;
            kernel: "exponential" | "bateman" | "zeroOrder";
            half_life_hours: number;
            tmax_hours: number;
          }>;
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
          </p>
        </main>
      </div>
    );
  }

  // Linearity gate (§5.7): non-linear drugs show the "can't model" panel.
  if (!pkParams.isLinear) {
    return (
      <div className="min-h-full">
        <Header medicationId={medicationId} name={med.display_name} />
        <main className="mx-auto max-w-2xl px-6 py-10">
          <h1 className="text-xl font-medium tracking-tight">
            {med.display_name} — Timeline
          </h1>
          <div className="mt-6">
            <NonLinearPanel reason={pkParams.nonlinearReason} />
          </div>
        </main>
      </div>
    );
  }

  // Time window.
  const now = Date.now();
  const rangeStart = now - PAST_DAYS * DAY_MS;
  const rangeEnd = now + FUTURE_DAYS * DAY_MS;
  const lookbackSince = new Date(rangeStart).toISOString();

  // Load dose logs.
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

  // Personal calibration (§4.8): load readings and compute personal half-life.
  let calibratedParams = pkParams;
  let isCalibrated = false;
  const { data: calibrations } = await supabase
    .from("pk_calibrations")
    .select("value, observed_at")
    .eq("medication_id", medicationId)
    .order("observed_at", { ascending: true });

  if (calibrations && calibrations.length >= 2) {
    const readings: CalibrationReading[] = calibrations.map((c) => ({
      value: Number(c.value),
      observedAt: new Date(c.observed_at as string).getTime(),
    }));

    const calResult = calibrateHalfLife(readings, pkParams.halfLifeHours);
    if (calResult.ok) {
      calibratedParams = { ...pkParams, halfLifeHours: calResult.personalHalfLifeHours };
      isCalibrated = true;
    }
  }

  // Compute the actual concentration series.
  const actualSeries = computeConcentration(
    doseEvents,
    calibratedParams,
    rangeStart,
    rangeEnd,
    now
  );

  // If calibrated, also compute the textbook series for comparison.
  let textbookSeries = undefined;
  if (isCalibrated) {
    textbookSeries = computeConcentration(
      doseEvents,
      pkParams, // original textbook params
      rangeStart,
      rangeEnd,
      now
    );
  }

  // Prescribed regimen overlay.
  const { data: prescribedRaw } = await supabase
    .from("prescribed_regimens")
    .select("dose_amount, frequency")
    .eq("medication_id", medicationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  let overlaySeries = undefined;
  if (prescribedRaw && !isCalibrated) {
    const freq = prescribedRaw.frequency as {
      type: string; interval?: number; unit?: string; count?: number; period?: string;
    };
    const scheduledDoses = generateScheduledDoses(
      freq, Number(prescribedRaw.dose_amount), rangeStart, rangeEnd
    );
    if (scheduledDoses.length > 0) {
      overlaySeries = computeConcentration(scheduledDoses, pkParams, rangeStart, rangeEnd, now);
    }
  }

  // Disclaimer text depends on whether the curve is calibrated (§6.1).
  const disclaimer = isCalibrated
    ? "Your personal estimate, based on the readings you entered. Illustrative, not a measurement. Not medical advice."
    : "Based on textbook half-life. Your body may vary. Not medical advice.";

  return (
    <div className="min-h-full">
      <Header medicationId={medicationId} name={med.display_name} />

      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-xl font-medium tracking-tight">
          {med.display_name} — Timeline
          {isCalibrated ? (
            <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
              calibrated
            </span>
          ) : null}
        </h1>
        <p className="mt-1 text-sm text-faint">
          Modelled concentration over the past {PAST_DAYS} days and projected
          next {FUTURE_DAYS} days.
        </p>

        <div className="mt-6">
          <PkChart
            series={actualSeries}
            overlay={isCalibrated ? textbookSeries : overlaySeries}
            provenance={isCalibrated ? "user_calibrated" : pkProvenance}
          />
        </div>

        {/* Disclaimer (§6.1) */}
        <p className="mt-4 rounded-md border border-line bg-surface p-3 text-xs text-faint">
          {disclaimer}
        </p>

        {/* Summary stats */}
        <div className="mt-6 grid gap-4 sm:grid-cols-4">
          <Stat label="Doses in window" value={String(doseEvents.length)} />
          <Stat
            label="Half-life"
            value={`${calibratedParams.halfLifeHours.toFixed(1)}h`}
          />
          <Stat
            label="Bioavailability"
            value={`${(calibratedParams.bioavailability * 100).toFixed(0)}%`}
          />
          <Stat label="Kernel" value={calibratedParams.kernel} />
        </div>

        {/* Links to calibration + explorer */}
        <div className="mt-6 flex gap-3 text-sm">
          <Link
            href={`/medications/${medicationId}/calibrate`}
            className="text-accent hover:underline"
          >
            Calibrate to my readings
          </Link>
          <Link
            href={`/medications/${medicationId}/explore`}
            className="text-accent hover:underline"
          >
            Explore a regimen
          </Link>
        </div>
      </main>
    </div>
  );
}

function Header({ medicationId, name }: { medicationId: string; name: string }) {
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
