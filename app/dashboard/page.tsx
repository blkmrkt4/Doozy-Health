import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActivePatient } from "@/lib/active-patient";
import { archiveSyringe } from "@/app/inventory/actions";
import { unarchiveMedication } from "@/app/medications/actions";
import { MedDoseRow } from "@/app/_components/med-dose-row";
import { dayKey, frequencyIntervalMs, occurrencesInWindow } from "@/lib/schedule";
import { acceptInvite, declineInvite } from "@/app/settings/caregivers/actions";
import { formatRegimenSummary, relativeAge } from "@/lib/format";
import { PatientSwitcher } from "@/app/_components/patient-switcher";
import { CalendarSection } from "@/app/_components/calendar-section";
import { AmountInSystemChart } from "@/app/_components/amount-in-system-chart";
import {
  buildWheelModel,
  type MedRegimen,
  type TakenLog,
  type DayLog,
  type MedLogMeta,
} from "@/lib/adherence";
import { resolveParams, type DoseEvent } from "@/lib/pharmacokinetics";
import type {
  DrugPK,
  DoseEvent as AisDoseEvent,
  PrescribedRegimen,
  Route,
} from "@/lib/pk/amountInSystem";
import {
  isFrequency,
  INJECTABLE_FORM_TYPES,
  type FormType,
  type TrackedField,
  type DiaryEntry,
} from "@/lib/types";

type AmountChartProps = {
  drug: DrugPK;
  doses: AisDoseEvent[];
  prescribed: PrescribedRegimen;
  identityColor?: string;
  nowDays: number;
  nowDate: Date;
};

type ChosenRow = {
  dose_amount: string;
  dose_unit: string;
  frequency: unknown;
  route: string;
  active: boolean;
  created_at: string;
};

type DeliveryRow = {
  form_type: string;
  concentration: { amount: number; per_volume: number } | null;
  syringe_spec: { capacity_mL?: number } | null;
  created_at: string;
};

type MedicationRow = {
  id: string;
  display_name: string;
  canonical_drug_id: string | null;
  is_private: boolean;
  entry_source: string;
  created_at: string;
  colour: string | null;
  chosen_regimens: ChosenRow[] | null;
  delivery_forms: DeliveryRow[] | null;
  syringe:
    | { spec: { capacity_mL?: number } | null }
    | { spec: { capacity_mL?: number } | null }[]
    | null;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const { day: selectedDayParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("email, is_system_admin")
    .eq("id", user.id)
    .maybeSingle();

  const activePatient = await getActivePatient(supabase);

  // Load all patient memberships for the patient switcher (PRD §9, §13.13).
  const { data: membershipRows } = await supabase
    .from("patient_memberships")
    .select("patient_id, role, accepted_at, patients(name)")
    .order("created_at");

  type SwitcherPatient = { id: string; name: string; role: "owner" | "caregiver" | "viewer" };
  const allPatients: SwitcherPatient[] = ((membershipRows ?? []) as Array<{
    patient_id: string;
    role: string;
    accepted_at: string | null;
    patients: { name: string } | { name: string }[] | null;
  }>)
    .filter((m) => m.accepted_at !== null) // only accepted memberships
    .map((m) => {
      const p = Array.isArray(m.patients) ? m.patients[0] : m.patients;
      return {
        id: m.patient_id,
        name: p?.name ?? "Patient",
        role: m.role as SwitcherPatient["role"],
      };
    });

  // Pending invites for this user (not yet accepted).
  const pendingInvites = ((membershipRows ?? []) as Array<{
    patient_id: string;
    role: string;
    accepted_at: string | null;
    patients: { name: string } | { name: string }[] | null;
  }>)
    .filter((m) => m.accepted_at === null)
    .map((m) => {
      const p = Array.isArray(m.patients) ? m.patients[0] : m.patients;
      // Need the membership ID for accept/decline. Re-query would be cleaner
      // but we'll use the patient_id to find it.
      return {
        patientId: m.patient_id,
        patientName: p?.name ?? "Patient",
        role: m.role,
      };
    });

  // Load membership IDs for pending invites (needed for the accept form).
  let pendingMembershipIds = new Map<string, string>();
  if (pendingInvites.length > 0) {
    const { data: pendingRows } = await supabase
      .from("patient_memberships")
      .select("id, patient_id")
      .is("accepted_at", null);
    for (const r of pendingRows ?? []) {
      pendingMembershipIds.set(r.patient_id as string, r.id as string);
    }
  }

  // RLS already restricts these rows to medications the caller may read,
  // including the is_private override for non-owners (PRD §5.6).
  const { data } = await supabase
    .from("medications")
    .select(
      "id, display_name, canonical_drug_id, is_private, entry_source, created_at, colour, chosen_regimens(dose_amount, dose_unit, frequency, route, active, created_at), delivery_forms(form_type, concentration, syringe_spec, created_at), syringe:inventory_items!medications_syringe_id_fkey(spec)"
    )
    .eq("archived", false)
    .eq("chosen_regimens.active", true)
    .order("created_at", { ascending: false });

  const medications = (data ?? []) as MedicationRow[];
  const isOwner = activePatient?.role === "owner";

  // Archived medications — hidden from the active list but available to add back
  // (PRD §5.6). Owner-only; archiving is owner-managed.
  const { data: archivedData } = isOwner
    ? await supabase
        .from("medications")
        .select("id, display_name, colour")
        .eq("archived", true)
        .order("display_name")
    : { data: null };
  const archivedMeds = (archivedData ?? []) as Array<{
    id: string;
    display_name: string;
    colour: string | null;
  }>;
  // Owners and caregivers can log doses (PRD §5.6); viewers cannot.
  const canLog =
    activePatient?.role === "owner" || activePatient?.role === "caregiver";

  // Drug interaction check: which medications have known interactions? (PRD §5.8)
  // Build a set of drug IDs that have at least one interaction with another
  // active medication on this patient.
  const drugIds = medications
    .map((m) => m.canonical_drug_id)
    .filter((id): id is string => Boolean(id));
  const medsWithInteractions = new Set<string>();

  if (drugIds.length >= 2) {
    // Query all interactions involving any pair of the patient's drug IDs.
    const { data: ixRows } = await supabase
      .from("drug_interactions")
      .select("drug_a_id, drug_b_id")
      .in("drug_a_id", drugIds)
      .in("drug_b_id", drugIds);

    const drugIdToMedIds = new Map<string, string[]>();
    for (const m of medications) {
      if (m.canonical_drug_id) {
        const arr = drugIdToMedIds.get(m.canonical_drug_id) ?? [];
        arr.push(m.id);
        drugIdToMedIds.set(m.canonical_drug_id, arr);
      }
    }

    for (const row of ixRows ?? []) {
      const aMeds = drugIdToMedIds.get(row.drug_a_id as string) ?? [];
      const bMeds = drugIdToMedIds.get(row.drug_b_id as string) ?? [];
      for (const id of aMeds) medsWithInteractions.add(id);
      for (const id of bMeds) medsWithInteractions.add(id);
    }
  }

  // Latest log per medication, for the neutral "last logged" line (PRD §9).
  // RLS scopes these to medications the caller may read.
  const { data: logRows } = await supabase
    .from("dose_logs")
    .select("id, medication_id, logged_at, event_type, amount, unit")
    .order("logged_at", { ascending: false });
  const lastLogged = new Map<string, string>();
  for (const r of logRows ?? []) {
    if (!lastLogged.has(r.medication_id)) {
      lastLogged.set(r.medication_id, r.logged_at);
    }
  }

  // ── Medication calendar (the date-wheel + adherence heatmap, PRD §5.4) ─────
  // Regimens, logs, names and colours assembled for the overall wheel and a
  // per-drug wheel on each card. The adherence grade is a factual record of
  // logged-versus-scheduled doses (deterministic — no LLM, hard rule #8).
  const nowMs = Date.now();
  const regimens: MedRegimen[] = [];
  const medNames: Record<string, string> = {};
  const medMeta: Record<string, MedLogMeta> = {};
  for (const m of medications) {
    medNames[m.id] = m.display_name;
    const chosen = (m.chosen_regimens ?? []).find((c) => c.active);
    if (!chosen || !isFrequency(chosen.frequency)) continue;
    const anchorMs = new Date(chosen.created_at ?? m.created_at).getTime();
    if (!Number.isFinite(anchorMs)) continue;
    regimens.push({
      medicationId: m.id,
      frequency: chosen.frequency,
      anchorMs,
      doseAmount: Number(chosen.dose_amount),
      doseUnit: chosen.dose_unit,
      colour: m.colour ?? "#777777",
    });

    const delivery = [...(m.delivery_forms ?? [])].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];
    medMeta[m.id] = {
      medId: m.id,
      name: m.display_name,
      colour: m.colour ?? "#777777",
      defaultAmount: Number(chosen.dose_amount),
      defaultUnit: chosen.dose_unit,
      defaultRoute: chosen.route,
      isInjectable: delivery
        ? INJECTABLE_FORM_TYPES.has(delivery.form_type as FormType)
        : false,
      concentrationAmount: delivery?.concentration?.amount ?? null,
      concentrationPerVolume: delivery?.concentration?.per_volume ?? null,
      syringeCapacityMl:
        (Array.isArray(m.syringe) ? m.syringe[0]?.spec : m.syringe?.spec)
          ?.capacity_mL ??
        delivery?.syringe_spec?.capacity_mL ??
        null,
    };
  }
  const takenLogs: TakenLog[] = (logRows ?? [])
    .filter((r) => r.event_type === "taken")
    .map((r) => ({
      medicationId: r.medication_id,
      loggedAtMs: new Date(r.logged_at).getTime(),
      amount: r.amount != null ? Number(r.amount) : null,
      unit: (r.unit as string | null) ?? null,
    }));
  const wheelModel = buildWheelModel({ nowMs, rangeDays: 50, regimens, takenLogs });

  // All logs (incl. skips/PRN) for the calendar agenda's per-day list + delete.
  const calendarDayLogs: DayLog[] = (logRows ?? []).map((r) => ({
    id: r.id as string,
    medId: r.medication_id,
    loggedAtMs: new Date(r.logged_at).getTime(),
    eventType: r.event_type as DayLog["eventType"],
    amount: r.amount != null ? Number(r.amount) : null,
    unit: (r.unit as string | null) ?? null,
  }));

  // A per-drug wheel model for the calendar bar on each medication card.
  const wheelByMed = new Map<string, ReturnType<typeof buildWheelModel>>();
  for (const reg of regimens) {
    wheelByMed.set(
      reg.medicationId,
      buildWheelModel({
        nowMs,
        rangeDays: 50,
        regimens: [reg],
        takenLogs: takenLogs.filter((t) => t.medicationId === reg.medicationId),
      })
    );
  }

  // Inline PK sparkline per card (PRD §5.7): illustrative modelled level from
  // logged doses + the chosen schedule reference. Deterministic (no LLM); only
  // linear drugs with PK reference data. Coarse step keeps N cards cheap.
  // Per-medication "amount in system" chart inputs (chart-guidance.md). Built
  // from logged doses + the drug's PK params + the chosen regimen; the chart
  // component does all display maths.
  const amountChartByMed = new Map<string, AmountChartProps>();
  const pkDrugIds = Array.from(
    new Set(
      medications
        .map((m) => m.canonical_drug_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  if (pkDrugIds.length > 0) {
    const { data: pkDrugs } = await supabase
      .from("drugs")
      .select(
        "id, half_life_hours, half_life_range_hours, bioavailability, tmax_hours, " +
          "kernel_by_route, release_duration_hours, is_linear, nonlinear_reason, metabolites"
      )
      .in("id", pkDrugIds);
    const drugById = new Map(
      ((pkDrugs ?? []) as unknown as Array<Record<string, unknown>>).map((d) => [
        String(d.id),
        d,
      ])
    );

    const pkPastMs = nowMs - 30 * 24 * 3_600_000;
    const doseEventsByMed = new Map<string, DoseEvent[]>();
    for (const r of logRows ?? []) {
      if (!(r.event_type === "taken" || r.event_type === "prn") || !r.amount) continue;
      const ts = new Date(r.logged_at).getTime();
      if (ts < pkPastMs) continue;
      const arr = doseEventsByMed.get(r.medication_id) ?? [];
      arr.push({ timestamp: ts, amount: Number(r.amount) });
      doseEventsByMed.set(r.medication_id, arr);
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
      if (!params) continue; // non-linear drugs still render (the "can't model" panel)

      const intervalMs = frequencyIntervalMs(chosen.frequency);
      const intervalDays = intervalMs ? intervalMs / 86_400_000 : 7;
      const perDose = Number(chosen.dose_amount);
      const dayOf = (ms: number) => (ms - pkPastMs) / 86_400_000;

      const logged: AisDoseEvent[] = (doseEventsByMed.get(m.id) ?? []).map((e) => ({
        t: dayOf(e.timestamp),
        amount: e.amount,
        taken: true,
      }));
      // Project the chosen cadence forward two weeks (dashed, after "now").
      const future: AisDoseEvent[] = occurrencesInWindow(
        chosen.frequency,
        nowMs,
        nowMs + 1,
        nowMs + 14 * 86_400_000
      ).map((ms) => ({ t: dayOf(ms), amount: perDose, taken: true }));

      const perPeriodDose =
        intervalDays > 0 ? Math.round(perDose * (7 / intervalDays)) : undefined;

      const drugPk: DrugPK = {
        name: m.display_name,
        route: chosen.route as Route,
        unit: chosen.dose_unit,
        halfLifeDays: params.halfLifeHours / 24,
        halfLifeRangeDays: params.halfLifeRange
          ? [params.halfLifeRange[0] / 24, params.halfLifeRange[1] / 24]
          : undefined,
        isLinear: params.isLinear,
        model: "amount_in_system",
        // Route-aware shape (Fix 1): the chart picks an instant / first-order /
        // zero-order kernel from the route, sharpened by Tmax and (for patches)
        // the release window when the drug record carries them.
        tmaxDays: params.tmaxHours ? params.tmaxHours / 24 : undefined,
        releaseDurationDays: params.releaseDurationHours
          ? params.releaseDurationHours / 24
          : undefined,
        provenance: "curated",
      };

      const prescribed: PrescribedRegimen = {
        perDose,
        intervalDays,
        perPeriodDose,
        perPeriodLabel: perPeriodDose
          ? `${perPeriodDose} ${chosen.dose_unit} = one week's dose (what goes in)`
          : undefined,
      };

      amountChartByMed.set(m.id, {
        drug: drugPk,
        doses: [...logged, ...future].sort((a, b) => a.t - b.t),
        prescribed,
        identityColor: m.colour ?? undefined,
        nowDays: dayOf(nowMs),
        nowDate: new Date(nowMs),
      });
    }
  }

  // Diary (PRD §5.9): active tracked fields (+ med scope links) and the daily
  // diary entries, for the calendar's per-day Diary twisty.
  let diaryFields: TrackedField[] = [];
  const diaryEntriesByDay = new Map<string, DiaryEntry>();
  if (activePatient) {
    const { data: tfRows } = await supabase
      .from("tracked_fields")
      .select("id, name, field_type, unit, category_options, display_order")
      .eq("patient_id", activePatient.id)
      .eq("active", true)
      .order("display_order");
    const { data: tfmRows } = await supabase
      .from("tracked_field_medications")
      .select("tracked_field_id, medication_id")
      .eq("patient_id", activePatient.id);
    const tfMeds = new Map<string, string[]>();
    for (const r of (tfmRows ?? []) as { tracked_field_id: string; medication_id: string }[]) {
      const a = tfMeds.get(r.tracked_field_id) ?? [];
      a.push(r.medication_id);
      tfMeds.set(r.tracked_field_id, a);
    }
    diaryFields = ((tfRows ?? []) as TrackedField[]).map((f) => ({
      ...f,
      medicationIds: tfMeds.get(f.id) ?? [],
    }));

    const { data: deRows } = await supabase
      .from("diary_entries")
      .select("id, entry_at, entry_date, field_values, note")
      .eq("patient_id", activePatient.id)
      .not("entry_date", "is", null);
    for (const e of (deRows ?? []) as DiaryEntry[]) {
      if (e.entry_date) diaryEntriesByDay.set(e.entry_date, e);
    }
  }

  // Syringe inventory (PRD §5.1) — supplies on hand, shown as inventory rows.
  const { data: inventoryRows } = await supabase
    .from("inventory_items")
    .select("id, label, category, spec")
    .eq("archived", false)
    .order("created_at", { ascending: false });
  const syringes = (inventoryRows ?? []) as Array<{
    id: string;
    label: string;
    category: string;
    spec: {
      capacity_mL?: number;
      needle_gauge?: number;
      needle_length_in?: number;
      unit_markings?: string;
    } | null;
  }>;

  return (
    <div className="min-h-full">
      {/* Patient context — global navigation lives in the app nav now; this
          slim strip only carries the active-patient switcher / role. */}
      {activePatient && (allPatients.length > 1 || activePatient.role !== "owner") ? (
        <div className="border-b border-line">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-2 text-sm">
            {allPatients.length > 1 ? (
              <PatientSwitcher patients={allPatients} activeId={activePatient.id} />
            ) : (
              <span className="text-muted">
                {activePatient.name}
                {activePatient.role !== "owner" ? (
                  <span className="ml-1 text-faint">({activePatient.role})</span>
                ) : null}
              </span>
            )}
          </div>
        </div>
      ) : null}

      <main className="mx-auto max-w-5xl px-6 py-12">
        {/* Pending invites (PRD §4.5) */}
        {pendingInvites.length > 0 ? (
          <section className="mb-8 rounded-md border border-yellow-900 bg-yellow-950/10 p-4 space-y-3">
            <h2 className="text-sm font-medium text-paper">Pending invites</h2>
            {pendingInvites.map((inv) => {
              const mId = pendingMembershipIds.get(inv.patientId);
              return (
                <div
                  key={inv.patientId}
                  className="flex items-center justify-between gap-3"
                >
                  <p className="text-sm text-muted">
                    <span className="text-paper">{inv.patientName}</span> — invited
                    as {inv.role}
                  </p>
                  {mId ? (
                    <div className="flex gap-2">
                      <form action={acceptInvite}>
                        <input type="hidden" name="membership_id" value={mId} />
                        <button
                          type="submit"
                          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:opacity-90"
                        >
                          Accept
                        </button>
                      </form>
                      <form action={declineInvite}>
                        <input type="hidden" name="membership_id" value={mId} />
                        <button
                          type="submit"
                          className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:bg-surface"
                        >
                          Decline
                        </button>
                      </form>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        ) : null}

        {/* Overall medication calendar (PRD §5.4, §9): draggable date-wheel with
            the adherence heatmap and per-medication colour dots. */}
        {medications.length > 0 ? (
          <CalendarSection
            model={wheelModel}
            medNames={medNames}
            dayLogs={calendarDayLogs}
            medMeta={medMeta}
            canLog={canLog}
            initialDayKey={selectedDayParam}
            diaryFields={diaryFields}
            diaryEntriesByDay={diaryEntriesByDay}
          />
        ) : null}

        <section className="flex items-center justify-between">
          <h1 className="text-sm font-medium text-muted">Medications</h1>
          {isOwner ? (
            <div className="flex items-center gap-2">
              <Link
                href="/inventory/new"
                className="rounded-md border border-line px-3 py-2 text-sm text-muted transition-colors hover:bg-surface"
              >
                + Add syringe
              </Link>
              <Link
                href="/medications/new"
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
              >
                + Add medication
              </Link>
            </div>
          ) : null}
        </section>

        {medications.length === 0 ? (
          <section className="mt-8 rounded-md border border-dashed border-line px-6 py-16 text-center">
            <p className="text-sm text-muted">No medications yet.</p>
            {isOwner ? (
              <p className="mt-1 text-xs text-faint">
                Add your first to start tracking.
              </p>
            ) : null}
          </section>
        ) : (
          <ul className="mt-6 divide-y divide-line overflow-hidden rounded-md border border-line">
            {medications.map((m) => {
              const chosen = (m.chosen_regimens ?? []).find((c) => c.active);
              const last = lastLogged.get(m.id);
              const medWheel = wheelByMed.get(m.id) ?? null;
              const medChart = amountChartByMed.get(m.id) ?? null;
              const todayD = medWheel ? medWheel.days[medWheel.todayIndex] : null;
              const todayMark = todayD?.meds.find((x) => x.medId === m.id);
              const todayTakenIds = todayD
                ? calendarDayLogs
                    .filter(
                      (l) =>
                        l.medId === m.id &&
                        l.eventType === "taken" &&
                        dayKey(l.loggedAtMs) === todayD.key
                    )
                    .sort((a, b) => a.loggedAtMs - b.loggedAtMs)
                    .map((l) => l.id)
                : [];
              return (
                <li key={m.id} className="px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                  <Link
                    href={`/medications/${m.id}`}
                    className="min-w-0 flex-1 transition-colors hover:opacity-80"
                  >
                    <p className="truncate text-base font-medium text-paper">
                      <span className="blur-private">{m.display_name}</span>
                      {m.is_private ? (
                        <span
                          className="ml-2 align-middle text-xs text-faint"
                          title="Private"
                        >
                          🔒
                        </span>
                      ) : null}
                      {medsWithInteractions.has(m.id) ? (
                        <span
                          className="ml-2 align-middle rounded-full bg-yellow-950 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400"
                          title="Known interaction — view details"
                        >
                          interaction
                        </span>
                      ) : null}
                    </p>
                    {chosen ? (
                      <p className="mt-0.5 tabular text-sm text-muted blur-private">
                        {formatRegimenSummary(chosen)}
                      </p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-faint">
                      {/* Staleness dot: amber if not logged in 48+ hours (PRD §9).
                          Neutral tone, never accusatory. */}
                      {last && Date.now() - new Date(last).getTime() > 48 * 3_600_000 ? (
                        <span className="stale-dot" title="Not logged recently" />
                      ) : null}
                      {last ? `Last logged ${relativeAge(last)}` : "No doses logged yet"}
                    </p>
                  </Link>
                  {canLog && chosen ? (
                    <MedDoseRow
                      meta={medMeta[m.id]}
                      medColour={m.colour ?? "#777777"}
                      medName={m.display_name}
                      scheduled={todayMark?.scheduled ?? 0}
                      logged={todayMark?.logged ?? 0}
                      logIds={todayTakenIds}
                      dayMs={todayD?.ms ?? nowMs}
                      isToday={true}
                      canLog={canLog}
                      minDots={1}
                      dotsOnly
                    />
                  ) : null}
                  </div>
                  {medWheel ? (
                    <div className="mt-4">
                      <CalendarSection
                        model={medWheel}
                        medNames={medNames}
                        variant="bar"
                      />
                    </div>
                  ) : null}
                  {medChart ? (
                    <div className="mt-4">
                      <AmountInSystemChart
                        drug={medChart.drug}
                        doses={medChart.doses}
                        prescribed={medChart.prescribed}
                        identityColor={medChart.identityColor}
                        nowDays={medChart.nowDays}
                        nowDate={medChart.nowDate}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {/* Inventory — supplies on hand (syringes). A disclosure twisty per item
            (PRD §5.1). Owners can remove. */}
        {syringes.length > 0 ? (
          <section className="mt-8">
            <h2 className="mb-2 text-sm font-medium text-muted">Inventory</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
              {syringes.map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <details>
                    <summary className="flex cursor-pointer list-none items-center gap-3 text-sm">
                      <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-faint">
                        syringe
                      </span>
                      <span className="min-w-0 flex-1 truncate text-paper blur-private">
                        {s.label}
                      </span>
                      <span className="text-xs text-faint">on hand</span>
                    </summary>
                    <div className="mt-2 space-y-1 pl-1 text-xs text-faint">
                      {s.spec?.capacity_mL ? <p>Capacity: {s.spec.capacity_mL} mL</p> : null}
                      {s.spec?.needle_gauge ? <p>Needle gauge: {s.spec.needle_gauge}G</p> : null}
                      {s.spec?.needle_length_in ? <p>Needle length: {s.spec.needle_length_in} in</p> : null}
                      {s.spec?.unit_markings ? <p>Markings: {s.spec.unit_markings}</p> : null}
                      {isOwner ? (
                        <form action={archiveSyringe} className="pt-1">
                          <input type="hidden" name="syringe_id" value={s.id} />
                          <input type="hidden" name="return_to" value="/dashboard" />
                          <button type="submit" className="text-faint underline hover:text-muted">
                            Remove
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {isOwner && archivedMeds.length > 0 ? (
          <section className="mt-8">
            <details>
              <summary className="mb-2 cursor-pointer list-none text-sm font-medium text-muted">
                Archived ({archivedMeds.length})
              </summary>
              <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
                {archivedMeds.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: m.colour ?? "#777777" }}
                      />
                      <Link
                        href={`/medications/${m.id}`}
                        className="min-w-0 truncate text-sm text-paper blur-private hover:underline"
                      >
                        {m.display_name}
                      </Link>
                    </span>
                    <form action={unarchiveMedication} className="shrink-0">
                      <input type="hidden" name="medication_id" value={m.id} />
                      <button
                        type="submit"
                        className="text-xs text-faint underline transition-colors hover:text-muted"
                      >
                        Add back
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        ) : null}

        {profile?.is_system_admin ? (
          <p className="mt-16 text-xs text-faint">
            <Link href="/admin/settings" className="underline hover:text-muted">
              Admin
            </Link>
          </p>
        ) : null}
      </main>
    </div>
  );
}
