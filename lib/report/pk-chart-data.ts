import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveParams } from "@/lib/pharmacokinetics";
import { frequencyIntervalMs } from "@/lib/schedule";
import {
  provenanceFromReferenceData,
  type DrugPK,
  type DoseEvent as AisDoseEvent,
  type PrescribedRegimen,
} from "@/lib/pk/amountInSystem";
import { isFrequency } from "@/lib/types";
import type { MedicationRow, DoseLogRow } from "@/lib/report/report-data";

// Per-medication "amount in system" chart inputs for the doctor report
// (PRD §5.10 — a PK chart per medication; §5.7 engine). Deterministic: the SVG
// chart does all display maths (hard rule #8). Mirrors the dashboard's inline
// chart assembly but anchored to the report's date range — the report is a
// record, so doses are plotted as logged with no forward projection. Only
// medications with a linked drug PK row and an active regimen get a chart.

const MS_DAY = 86_400_000;

export type ReportPkChart = {
  drug: DrugPK;
  doses: AisDoseEvent[];
  prescribed: PrescribedRegimen;
  identityColor: string | null;
  nowDays: number;
  nowDate: Date;
};

export async function buildReportPkCharts(
  supabase: SupabaseClient,
  medications: MedicationRow[],
  doseLogs: DoseLogRow[],
  from: string,
  to: string
): Promise<Map<string, ReportPkChart>> {
  const out = new Map<string, ReportPkChart>();

  const drugIds = Array.from(
    new Set(
      medications
        .map((m) => m.canonical_drug_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  if (drugIds.length === 0) return out;

  const { data: pkDrugs } = await supabase
    .from("drugs")
    .select(
      "id, half_life_hours, half_life_range_hours, bioavailability, tmax_hours, " +
        "kernel_by_route, release_duration_hours, is_linear, nonlinear_reason, metabolites, reference_data"
    )
    .in("id", drugIds);
  const drugById = new Map(
    ((pkDrugs ?? []) as unknown as Array<Record<string, unknown>>).map((d) => [
      String(d.id),
      d,
    ])
  );

  const fromMs = new Date(`${from}T00:00:00`).getTime();
  const toMs = new Date(`${to}T23:59:59`).getTime();
  const dayOf = (ms: number) => (ms - fromMs) / MS_DAY;
  const spanDays = Math.max(1, (toMs - fromMs) / MS_DAY);
  const nowDate = new Date(`${to}T12:00:00`);

  // Logged doses (taken/prn) per medication, within range.
  const dosesByMed = new Map<string, AisDoseEvent[]>();
  for (const l of doseLogs) {
    if (!(l.event_type === "taken" || l.event_type === "prn") || !l.amount) continue;
    const ts = new Date(l.logged_at).getTime();
    if (ts < fromMs || ts > toMs) continue;
    const arr = dosesByMed.get(l.medication_id) ?? [];
    arr.push({ t: dayOf(ts), amount: Number(l.amount), taken: true });
    dosesByMed.set(l.medication_id, arr);
  }

  for (const m of medications) {
    if (!m.canonical_drug_id) continue;
    const chosen = (m.chosen_regimens ?? []).find((c) => c.active);
    if (!chosen || !isFrequency(chosen.frequency)) continue;
    const drug = drugById.get(m.canonical_drug_id);
    if (!drug) continue;
    const params = resolveParams(
      drug as unknown as Parameters<typeof resolveParams>[0],
      chosen.route
    );
    if (!params) continue; // non-linear still renders the "can't model" panel below

    const doses = (dosesByMed.get(m.id) ?? []).sort((a, b) => a.t - b.t);
    if (doses.length === 0) continue; // nothing logged for this med in range

    const intervalMs = frequencyIntervalMs(chosen.frequency);
    const intervalDays = intervalMs ? intervalMs / MS_DAY : 7;
    const perDose = Number(chosen.dose_amount);
    const perPeriodDose =
      intervalDays > 0 ? Math.round(perDose * (7 / intervalDays)) : undefined;

    const drugPk: DrugPK = {
      name: m.display_name,
      route: chosen.route as DrugPK["route"],
      unit: chosen.dose_unit,
      halfLifeDays: params.halfLifeHours / 24,
      halfLifeRangeDays: params.halfLifeRange
        ? [params.halfLifeRange[0] / 24, params.halfLifeRange[1] / 24]
        : undefined,
      isLinear: params.isLinear,
      model: "amount_in_system",
      tmaxDays: params.tmaxHours ? params.tmaxHours / 24 : undefined,
      releaseDurationDays: params.releaseDurationHours
        ? params.releaseDurationHours / 24
        : undefined,
      provenance: provenanceFromReferenceData(
        (drug as { reference_data?: unknown }).reference_data
      ),
    };

    const prescribed: PrescribedRegimen = {
      perDose,
      intervalDays,
      perPeriodDose,
      perPeriodLabel: perPeriodDose
        ? `${perPeriodDose} ${chosen.dose_unit} per week (what goes in)`
        : undefined,
    };

    out.set(m.id, {
      drug: drugPk,
      doses,
      prescribed,
      identityColor: m.colour,
      nowDays: spanDays,
      nowDate,
    });
  }

  return out;
}
