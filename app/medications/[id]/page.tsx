import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  formatDose,
  formatFrequency,
  formatRegimenSummary,
  formatRoute,
  relativeAge,
} from "@/lib/format";
import {
  resolveParams,
  buildMedicationPkSeries,
  type DoseEvent,
} from "@/lib/pharmacokinetics";
import { PkChart } from "./timeline/pk-chart";
import {
  FORM_TYPE_LABELS,
  INJECTABLE_FORM_TYPES,
  isFrequency,
  type FormType,
  type TrackedField,
  type DiaryEntry,
} from "@/lib/types";
import {
  buildWheelModel,
  type MedRegimen,
  type TakenLog,
  type WheelModel,
  type DayLog,
  type MedLogMeta,
} from "@/lib/adherence";
import { CalendarSection } from "@/app/_components/calendar-section";
import { MedDoseRow } from "@/app/_components/med-dose-row";
import { dayKey } from "@/lib/schedule";
import { checkInteractions, type InteractionRecord } from "@/lib/interactions";
import { InteractionCard } from "@/app/medications/_components/interaction-card";
import {
  attachMedicationPhoto,
  deleteDocument,
  deleteDoseLog,
  enableSchedule,
  disableSchedule,
  runVerification,
  setMedicationPrivacy,
} from "@/app/medications/actions";
import { RemoveMedicationControls } from "./_components/remove-medication";
import {
  DOCUMENTS_BUCKET,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/documents";
import { LogDoseForm } from "./log-dose-form";
import { SyringeVisual } from "@/app/medications/_components/syringe-visual";
import { buildSetupChecklist } from "@/lib/medication-setup";
import { SetupChecklist } from "@/app/medications/[id]/_components/setup-checklist";

type Regimen = {
  dose_amount: string;
  dose_unit: string;
  frequency: unknown;
  route: string;
  created_at: string;
  duration_days?: number | null;
  prescriber_name?: string | null;
  reason_note?: string | null;
  directions?: string | null;
  active?: boolean;
};

type DeliveryForm = {
  form_type: string;
  concentration: {
    amount: number;
    unit: string;
    per_volume: number;
    volume_unit: string;
  } | null;
  syringe_spec: {
    capacity_mL?: number;
    needle_gauge?: number;
    needle_length_in?: number;
    unit_markings?: string;
  } | null;
  reconstitution: {
    requires_reconstitution?: boolean;
    diluent_type?: string;
    diluent_volume_ml?: number;
    powder_amount?: number;
    powder_unit?: string;
  } | null;
  package_count: string | null;
  package_unit: string | null;
  expiry_date: string | null;
  batch: string | null;
  manufacturer: string | null;
  created_at: string;
};

type Medication = {
  id: string;
  patient_id: string;
  display_name: string;
  canonical_drug_id: string | null;
  is_private: boolean;
  entry_source: string;
  archived: boolean;
  syringe_id: string | null;
  accessories: unknown;
  prescribed_regimens: Regimen[] | null;
  delivery_forms: DeliveryForm[] | null;
  chosen_regimens: Regimen[] | null;
};

function byNewest<T extends { created_at: string }>(rows: T[] | null): T[] {
  return [...(rows ?? [])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs text-faint">{label}</span>
      <span className="tabular text-sm text-paper text-right">{value}</span>
    </div>
  );
}

export default async function MedicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; new?: string; day?: string }>;
}) {
  const { id } = await params;
  const { error: errorParam, new: isNew, day: selectedDayParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("medications")
    .select(
      "id, patient_id, display_name, canonical_drug_id, is_private, entry_source, archived, colour, syringe_id, accessories, prescribed_regimens(*), delivery_forms(*), chosen_regimens(*)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const med = data as Medication;

  // Owner controls require the owner role on THIS medication's patient;
  // owners and caregivers can log doses (PRD §5.6).
  const { data: membership } = await supabase
    .from("patient_memberships")
    .select("role")
    .eq("patient_id", med.patient_id)
    .maybeSingle();
  const isOwner = membership?.role === "owner";
  const canLog = isOwner || membership?.role === "caregiver";

  const prescribed = byNewest(med.prescribed_regimens)[0] ?? null;
  const delivery = byNewest(med.delivery_forms)[0] ?? null;
  const chosen =
    (med.chosen_regimens ?? []).find((c) => c.active) ??
    byNewest(med.chosen_regimens)[0] ??
    null;

  const isInjectable = delivery
    ? INJECTABLE_FORM_TYPES.has(delivery.form_type as FormType)
    : false;

  // The chosen syringe (inventory) drives the calibrated visual size; fall back
  // to the delivery form's spec, then 1 mL (PRD §5.1).
  let linkedSyringeCapacityMl: number | null = null;
  if (med.syringe_id) {
    const { data: syr } = await supabase
      .from("inventory_items")
      .select("spec")
      .eq("id", med.syringe_id)
      .maybeSingle();
    const spec = (syr?.spec ?? null) as { capacity_mL?: number } | null;
    linkedSyringeCapacityMl = spec?.capacity_mL ?? null;
  }
  const resolvedCapacityMl =
    linkedSyringeCapacityMl ?? delivery?.syringe_spec?.capacity_mL ?? null;

  // Recent dose history (RLS-scoped to this medication's visibility).
  const { data: logData } = await supabase
    .from("dose_logs")
    .select("id, event_type, logged_at, amount, unit, route_taken, site, note, source")
    .eq("medication_id", med.id)
    .order("logged_at", { ascending: false })
    .limit(50);
  const logs = logData ?? [];

  // Total logged doses — drives the archive-vs-delete guidance (history present
  // → archiving is the safer default). Counted separately since `logs` is capped.
  const { count: doseCountRaw } = await supabase
    .from("dose_logs")
    .select("id", { count: "exact", head: true })
    .eq("medication_id", med.id)
    .eq("event_type", "taken");
  const doseCount = doseCountRaw ?? 0;

  // Single-medication calendar (PRD §5.4): the date-wheel + adherence heatmap
  // for this medication. The grade is a factual record of logged-vs-scheduled.
  let medWheel: WheelModel | null = null;
  if (chosen && isFrequency(chosen.frequency)) {
    const anchorMs = new Date(
      (chosen as { created_at?: string }).created_at ?? Date.now()
    ).getTime();
    const reg: MedRegimen = {
      medicationId: med.id,
      frequency: chosen.frequency,
      anchorMs,
      doseAmount: Number(chosen.dose_amount),
      doseUnit: chosen.dose_unit,
      colour: (med as { colour?: string | null }).colour ?? "#777777",
    };
    const taken: TakenLog[] = logs
      .filter((l) => l.event_type === "taken")
      .map((l) => ({
        medicationId: med.id,
        loggedAtMs: new Date(l.logged_at as string).getTime(),
        amount: l.amount != null ? Number(l.amount) : null,
        unit: (l.unit as string | null) ?? null,
      }));
    medWheel = buildWheelModel({
      nowMs: Date.now(),
      rangeDays: 50,
      regimens: [reg],
      takenLogs: taken,
    });
  }

  // Per-day logs + log-control context for the calendar agenda (backdate/delete).
  const calendarDayLogs: DayLog[] = logs.map((l) => ({
    id: l.id as string,
    medId: med.id,
    loggedAtMs: new Date(l.logged_at as string).getTime(),
    eventType: l.event_type as DayLog["eventType"],
    amount: l.amount != null ? Number(l.amount) : null,
    unit: (l.unit as string | null) ?? null,
  }));
  const calendarMedMeta: Record<string, MedLogMeta> = {};
  if (chosen) {
    calendarMedMeta[med.id] = {
      medId: med.id,
      name: med.display_name,
      colour: (med as { colour?: string | null }).colour ?? "#777777",
      defaultAmount: Number(chosen.dose_amount),
      defaultUnit: chosen.dose_unit,
      defaultRoute: chosen.route,
      isInjectable,
      concentrationAmount: delivery?.concentration?.amount ?? null,
      concentrationPerVolume: delivery?.concentration?.per_volume ?? null,
      syringeCapacityMl: resolvedCapacityMl,
    };
  }

  // Today's mark + taken-log ids, for the streamlined check-dot logger at the
  // top of the page (replaces the old "Taken now" button).
  const todayDay = medWheel ? medWheel.days[medWheel.todayIndex] : null;
  const todayMark = todayDay?.meds.find((x) => x.medId === med.id);
  const todayTakenIds = todayDay
    ? calendarDayLogs
        .filter((l) => l.eventType === "taken" && dayKey(l.loggedAtMs) === todayDay.key)
        .sort((a, b) => a.loggedAtMs - b.loggedAtMs)
        .map((l) => l.id)
    : [];

  // Diary (PRD §5.9): patient-wide active fields + scope links + daily entries.
  let diaryFields: TrackedField[] = [];
  const diaryEntriesByDay = new Map<string, DiaryEntry>();
  {
    const { data: tfRows } = await supabase
      .from("tracked_fields")
      .select("id, name, field_type, unit, category_options, display_order")
      .eq("patient_id", med.patient_id)
      .eq("active", true)
      .order("display_order");
    const { data: tfmRows } = await supabase
      .from("tracked_field_medications")
      .select("tracked_field_id, medication_id")
      .eq("patient_id", med.patient_id);
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
      .eq("patient_id", med.patient_id)
      .not("entry_date", "is", null);
    for (const e of (deRows ?? []) as DiaryEntry[]) {
      if (e.entry_date) diaryEntriesByDay.set(e.entry_date, e);
    }
  }

  // Inline pharmacokinetic sparkline (PRD §5.7): illustrative modelled level
  // from logged doses, with the chosen schedule as the "where you'd sit"
  // reference. Deterministic — no LLM (rule #8). Only for linear drugs with PK
  // reference data; the full chart with axes/calibration is on /timeline.
  let pkSeries: ReturnType<typeof buildMedicationPkSeries> | null = null;
  if (med.canonical_drug_id && chosen && isFrequency(chosen.frequency)) {
    const { data: drug } = await supabase
      .from("drugs")
      .select(
        "half_life_hours, half_life_range_hours, bioavailability, tmax_hours, " +
          "kernel_by_route, release_duration_hours, is_linear, nonlinear_reason, metabolites"
      )
      .eq("id", med.canonical_drug_id)
      .single();
    const params = drug
      ? resolveParams(
          drug as unknown as Parameters<typeof resolveParams>[0],
          chosen.route
        )
      : null;
    if (params && params.isLinear) {
      const now = Date.now();
      const pastMs = now - 30 * 24 * 3_600_000;
      const doseEvents: DoseEvent[] = logs
        .filter((l) => (l.event_type === "taken" || l.event_type === "prn") && l.amount)
        .map((l) => ({
          timestamp: new Date(l.logged_at as string).getTime(),
          amount: Number(l.amount),
        }))
        .filter((d) => d.timestamp >= pastMs);
      pkSeries = buildMedicationPkSeries({
        params,
        doseEvents,
        now,
        pastDays: 30,
        futureDays: 14,
        scheduleFrequency: chosen.frequency,
        scheduleDose: Number(chosen.dose_amount),
        stepMs: 4 * 3_600_000,
      });
    }
  }

  // Dose schedule (PRD §5.5). Shows whether reminders are enabled.
  const { data: scheduleData } = await supabase
    .from("dose_schedules")
    .select("id, next_due_at, escalation_delay_min")
    .eq("medication_id", med.id)
    .maybeSingle();
  const schedule = scheduleData as {
    id: string;
    next_due_at: string;
    escalation_delay_min: number | null;
  } | null;

  // Drug interactions (PRD §5.8, §13.14). Pairwise check against other
  // active medications' canonical drug IDs.
  let interactions: InteractionRecord[] = [];
  if (med.canonical_drug_id) {
    interactions = await checkInteractions(
      supabase,
      med.patient_id,
      med.canonical_drug_id
    );
  }

  // Attached documents + short-lived signed URLs (PRD §6.2). RLS scopes the
  // rows; the signed URLs respect storage RLS (is_private-aware).
  const { data: docData } = await supabase
    .from("documents")
    .select("id, storage_path, file_name, mime_type, document_type, status, uploaded_at")
    .eq("linked_medication_id", med.id)
    .order("uploaded_at", { ascending: false });
  const docs = docData ?? [];
  const docUrls = new Map<string, string>();
  if (docs.length > 0) {
    const { data: signed } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrls(
        docs.map((d) => d.storage_path),
        SIGNED_URL_TTL_SECONDS
      );
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) docUrls.set(s.path, s.signedUrl);
    }
  }

  // Setup checklist (PRD §5.1–5.3): what this medication references and what's
  // still missing. Data-bearing items computed from rows above; the syringe
  // picker is fed from the patient's inventory.
  const { data: syringeRows } = await supabase
    .from("inventory_items")
    .select("id, label")
    .eq("patient_id", med.patient_id)
    .eq("category", "syringe")
    .eq("archived", false)
    .order("created_at", { ascending: false });
  const syringes = (syringeRows ?? []) as { id: string; label: string }[];
  const hasPrescriptionDoc = docs.some(
    (d) => d.document_type === "prescription_scan"
  );
  const accessories = (Array.isArray(med.accessories) ? med.accessories : [])
    .map((a) => {
      const r = (a ?? {}) as Record<string, unknown>;
      const type = String(r.type ?? "");
      return {
        type,
        label: String(r.label ?? type),
        source: r.source as "prescription" | "label" | "inferred" | undefined,
        acknowledged: r.acknowledged === true,
      };
    })
    .filter((a) => a.type);
  const setupItems = buildSetupChecklist({
    delivery,
    prescribed,
    chosen,
    resolvedSyringeCapacityMl: resolvedCapacityMl,
    hasPrescriptionDoc,
    accessories,
  });

  return (
    <div className="min-h-full">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-sm text-faint hover:text-muted">
            ← Back
          </Link>
          <span className="text-xs text-faint">
            {med.entry_source === "manual" ? "Entered manually" : "From a photo"}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 space-y-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-medium tracking-tight">
              <span className="blur-private">{med.display_name}</span>
              {med.is_private ? (
                <span className="ml-2 align-middle text-sm text-faint" title="Private">
                  🔒
                </span>
              ) : null}
            </h1>
            {isOwner ? (
              <Link
                href={`/medications/${med.id}/edit`}
                className="rounded-md border border-line px-3 py-1 text-xs text-muted transition-colors hover:bg-surface"
              >
                Edit
              </Link>
            ) : null}
          </div>
          {chosen ? (
            <p className="mt-1 tabular text-sm text-muted blur-private">
              {formatRegimenSummary(chosen)}
            </p>
          ) : null}
        </div>


        {/* Inline modelled-level chart (PRD §5.7). Illustrative, labelled. */}
        {pkSeries ? (
          <section className="rounded-md border border-line bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium text-paper">Modelled level</h2>
              <Link
                href={`/medications/${med.id}/timeline`}
                className="text-xs text-accent hover:underline"
              >
                Full timeline →
              </Link>
            </div>
            <p className="mb-3 mt-0.5 text-xs text-faint">
              An illustration of how this medication builds up and clears, based
              on textbook half-life — past 30 days and the next 14. The dashed
              line is where you&rsquo;d sit if you follow your schedule.
            </p>
            <PkChart series={pkSeries.series} overlay={pkSeries.overlay} height={230} />
            <p className="mt-3 text-[11px] text-faint">
              Illustrative, not a measurement of your actual level. Not medical
              advice.
            </p>
          </section>
        ) : med.canonical_drug_id ? (
          <Link
            href={`/medications/${med.id}/timeline`}
            className="inline-block text-sm text-accent hover:underline"
          >
            View timeline
          </Link>
        ) : null}

        {errorParam ? (
          <p className="rounded-md border alert-error p-3 text-sm">
            {errorParam}
          </p>
        ) : null}

        {/* Drug interactions (PRD §5.8). Shows curated interaction records.
            Framing is informational, never directive (§6.1).
            When ?new=1 (just added), show a prominent banner. */}
        {interactions.length > 0 ? (
          <section className="space-y-3">
            {isNew ? (
              <p className="rounded-md border border-yellow-800 bg-yellow-950/20 p-3 text-sm text-yellow-300">
                This medication has known interactions with others you are
                taking. Please review below and discuss with your doctor or
                pharmacist.
              </p>
            ) : null}
            <h2 className="text-sm font-medium text-paper">
              Known interactions
            </h2>
            {interactions.map((ix) => (
              <InteractionCard
                key={ix.id}
                interactionId={ix.id}
                drugName={med.display_name}
                otherDrugName={ix.otherDrugName}
                severity={ix.severity}
                mechanism={ix.mechanism}
              />
            ))}
          </section>
        ) : null}

        {/* Log a dose — the primary action. One tap for the scheduled dose;
            "Log differently" expands the custom/PRN/skip path (§4.3, §5.4). */}
        {canLog && chosen ? (
          <section className="space-y-4 rounded-md border border-line p-4">
            {/* Today — tap the green dot(s) to log; the dose is editable. */}
            <MedDoseRow
              meta={calendarMedMeta[med.id]}
              medColour={(med as { colour?: string | null }).colour ?? "#777777"}
              medName="Today"
              scheduled={todayMark?.scheduled ?? 0}
              logged={todayMark?.logged ?? 0}
              logIds={todayTakenIds}
              dayMs={todayDay?.ms ?? Date.now()}
              isToday={true}
              canLog={canLog}
              minDots={1}
            />
            <div className="flex flex-wrap items-center gap-3">
              {/* Calibrated syringe visual for injectables (PRD §4.3, §9) */}
              {isInjectable && delivery?.concentration && delivery.concentration.amount ? (
                <SyringeVisual
                  doseAmount={Number(chosen.dose_amount)}
                  concentrationAmount={delivery.concentration.amount}
                  concentrationPerVolume={delivery.concentration.per_volume ?? 1}
                  syringeCapacityMl={resolvedCapacityMl ?? 1}
                />
              ) : null}
              <LogDoseForm
                medicationId={med.id}
                defaultAmount={String(chosen.dose_amount)}
                defaultUnit={chosen.dose_unit}
                defaultRoute={chosen.route}
                isInjectable={isInjectable}
                isPatch={delivery?.form_type === "patch"}
              />
            </div>
            {delivery?.reconstitution?.requires_reconstitution &&
            delivery.reconstitution.powder_amount &&
            delivery.reconstitution.diluent_volume_ml ? (
              <p className="text-xs text-faint">
                Reconstituted: {delivery.reconstitution.powder_amount}{" "}
                {delivery.reconstitution.powder_unit ?? delivery.concentration?.unit} +{" "}
                {delivery.reconstitution.diluent_volume_ml} mL{" "}
                {delivery.reconstitution.diluent_type || "diluent"} →{" "}
                {delivery.concentration
                  ? `${Number(
                      (
                        delivery.concentration.amount /
                        delivery.concentration.per_volume
                      ).toFixed(2)
                    )} ${delivery.concentration.unit}/mL`
                  : null}
                . Illustrative — follow your prescription.
              </p>
            ) : null}
          </section>
        ) : null}

        {/* Medication calendar (PRD §5.4): date-wheel + adherence heatmap for
            this medication. */}
        {medWheel ? (
          <CalendarSection
            model={medWheel}
            medNames={{ [med.id]: med.display_name }}
            dayLogs={calendarDayLogs}
            medMeta={calendarMedMeta}
            canLog={canLog}
            initialDayKey={selectedDayParam}
            diaryFields={diaryFields}
            diaryEntriesByDay={diaryEntriesByDay}
          />
        ) : null}

        {/* Directions as captured — plain-language instructions a caregiver can
            rely on at a glance, across however many patients they manage. */}
        {prescribed?.directions ? (
          <section className="rounded-md border border-accent/40 bg-surface p-4">
            <h2 className="text-sm font-medium text-accent">Directions</h2>
            <p className="mt-1 text-sm text-paper">{prescribed.directions}</p>
          </section>
        ) : null}

        {/* Chosen regimen — the layer that drives schedule + timeline. Shown
            first because it's what the user acts on. */}
        <section className="rounded-md border border-line p-4">
          <h2 className="text-sm font-medium text-paper">How you take it</h2>
          {chosen ? (
            <div className="mt-2">
              <Field
                label="Dose"
                value={formatDose(chosen.dose_amount, chosen.dose_unit)}
              />
              <Field label="Frequency" value={formatFrequency(chosen.frequency)} />
              <Field label="Route" value={formatRoute(chosen.route)} />
              {chosen.reason_note ? (
                <Field label="Reason" value={chosen.reason_note} />
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm text-faint">Not set.</p>
          )}
        </section>

        {/* Prescribed regimen */}
        <section className="rounded-md border border-line p-4">
          <h2 className="text-sm font-medium text-paper">What was prescribed</h2>
          {prescribed ? (
            <div className="mt-2">
              <Field
                label="Dose"
                value={formatDose(prescribed.dose_amount, prescribed.dose_unit)}
              />
              <Field
                label="Frequency"
                value={formatFrequency(prescribed.frequency)}
              />
              <Field label="Route" value={formatRoute(prescribed.route)} />
              {prescribed.duration_days ? (
                <Field
                  label="Duration"
                  value={`${prescribed.duration_days} days`}
                />
              ) : null}
              {prescribed.prescriber_name ? (
                <Field label="Prescriber" value={prescribed.prescriber_name} />
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm text-faint">Not set.</p>
          )}
        </section>

        {/* Delivery form */}
        <section className="rounded-md border border-line p-4">
          <h2 className="text-sm font-medium text-paper">What you have in hand</h2>
          {delivery ? (
            <div className="mt-2">
              <Field
                label="Form"
                value={
                  FORM_TYPE_LABELS[delivery.form_type as FormType] ??
                  delivery.form_type
                }
              />
              {delivery.concentration ? (
                <Field
                  label="Concentration"
                  value={`${delivery.concentration.amount} ${delivery.concentration.unit} / ${delivery.concentration.per_volume} ${delivery.concentration.volume_unit}`}
                />
              ) : null}
              {delivery.package_count ? (
                <Field
                  label="Pack"
                  value={`${delivery.package_count} ${delivery.package_unit ?? ""}`.trim()}
                />
              ) : null}
              {delivery.expiry_date ? (
                <Field label="Expiry" value={delivery.expiry_date} />
              ) : null}
              {delivery.batch ? <Field label="Batch" value={delivery.batch} /> : null}
              {delivery.manufacturer ? (
                <Field label="Manufacturer" value={delivery.manufacturer} />
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm text-faint">Not set.</p>
          )}
        </section>

        {/* Reminders (PRD §5.5). Enable/disable scheduled reminders for this
            medication. Only shown for non-as_needed frequencies. */}
        {isOwner && chosen && typeof chosen.frequency === "object" &&
          (chosen.frequency as { type: string }).type !== "as_needed" ? (
          <section className="rounded-md border border-line p-4 space-y-3">
            <h2 className="text-sm font-medium text-paper">Reminders</h2>
            {schedule ? (
              <>
                <p className="text-sm text-muted">
                  Reminders enabled. Next due{" "}
                  <span className="tabular text-paper">
                    {new Date(schedule.next_due_at).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </p>
                <form action={disableSchedule}>
                  <input type="hidden" name="medication_id" value={med.id} />
                  <input type="hidden" name="schedule_id" value={schedule.id} />
                  <button
                    type="submit"
                    className="text-sm text-faint underline hover:text-muted"
                  >
                    Disable reminders
                  </button>
                </form>
              </>
            ) : (
              <>
                <p className="text-sm text-faint">
                  No reminders set for this medication.
                </p>
                <form action={enableSchedule}>
                  <input type="hidden" name="medication_id" value={med.id} />
                  <button
                    type="submit"
                    className="rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface"
                  >
                    Enable reminders
                  </button>
                </form>
              </>
            )}
          </section>
        ) : null}

        {/* Setup checklist (PRD §5.1–5.3) — a collapsed twisty here; the live
            checklist for adding lives on the Add screen. Editable in place. */}
        {setupItems.length > 0 ? (
          <SetupChecklist
            medicationId={med.id}
            items={setupItems}
            syringes={syringes}
            currentSyringeId={med.syringe_id}
            isOwner={isOwner}
          />
        ) : null}

        {/* Photos & documents (PRD §5.1). Attach a vial/prescription photo for
            your records; reading + extraction (step 8) build on this. */}
        <section className="rounded-md border border-line p-4">
          <h2 className="text-sm font-medium text-paper">Photos &amp; documents</h2>

          {docs.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-3">
              {docs.map((d) => {
                const url = docUrls.get(d.storage_path);
                const isImage = d.mime_type.startsWith("image/");
                return (
                  <li key={d.id} className="relative">
                    <a
                      href={url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block h-20 w-20 overflow-hidden rounded-md border border-line bg-surface"
                      title={d.file_name}
                    >
                      {isImage && url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={url}
                          alt={d.file_name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-xs text-faint">
                          {d.mime_type === "application/pdf" ? "PDF" : "FILE"}
                        </span>
                      )}
                    </a>
                    <div className="mt-1 flex justify-center gap-2">
                      {/* Verify with AI (PRD §5.2.2) — for image docs that
                          haven't been extracted yet. */}
                      {canLog &&
                        d.mime_type.startsWith("image/") &&
                        d.status === "uploaded" ? (
                        <form action={runVerification}>
                          <input type="hidden" name="medication_id" value={med.id} />
                          <input type="hidden" name="document_id" value={d.id} />
                          <button
                            type="submit"
                            className="text-xs text-accent underline hover:opacity-80"
                          >
                            verify
                          </button>
                        </form>
                      ) : null}
                      {canLog ? (
                        <form action={deleteDocument}>
                          <input type="hidden" name="medication_id" value={med.id} />
                          <input type="hidden" name="document_id" value={d.id} />
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
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-faint">No photos attached.</p>
          )}

          {canLog ? (
            <form
              action={attachMedicationPhoto}
              className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4"
            >
              <input type="hidden" name="medication_id" value={med.id} />
              <label className="block text-sm text-muted">
                Type
                <select
                  name="document_type"
                  defaultValue="vial_photo"
                  className="mt-1 block rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent"
                >
                  {DOCUMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {DOCUMENT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <input
                type="file"
                name="file"
                required
                accept="image/jpeg,image/png,image/heic,image/heif,application/pdf"
                className="text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-2 file:text-sm file:text-paper"
              />
              <button
                type="submit"
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
              >
                Attach
              </button>
            </form>
          ) : null}
        </section>

        {/* Dose history — neutral, chronological; no streaks or guilt (§9). */}
        <section className="rounded-md border border-line p-4">
          <h2 className="text-sm font-medium text-paper">History</h2>
          {logs.length === 0 ? (
            <p className="mt-2 text-sm text-faint">No doses logged yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {logs.map((l) => (
                <li
                  key={l.id}
                  className="flex items-baseline justify-between gap-4 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-paper">
                      {l.event_type === "skipped" ? (
                        <span className="text-faint">Skipped</span>
                      ) : (
                        <span className="tabular">
                          {formatDose(l.amount as string, l.unit as string)}
                          {l.event_type === "prn" ? (
                            <span className="ml-2 text-xs text-faint">PRN</span>
                          ) : null}
                        </span>
                      )}
                      {l.route_taken ? (
                        <span className="ml-2 text-xs text-faint">
                          {formatRoute(l.route_taken)}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-faint">
                      {relativeAge(l.logged_at as string)}
                      {l.site ? ` · ${l.site}` : ""}
                      {l.source === "caregiver" ? " · by caregiver" : ""}
                      {l.note ? ` · ${l.note}` : ""}
                    </p>
                  </div>
                  {canLog ? (
                    <form action={deleteDoseLog} className="shrink-0">
                      <input type="hidden" name="medication_id" value={med.id} />
                      <input type="hidden" name="log_id" value={l.id as string} />
                      <button
                        type="submit"
                        className="text-xs text-faint underline transition-colors hover:text-muted"
                        title="Undo this log"
                      >
                        undo
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Owner controls */}
        {isOwner ? (
          <section className="flex flex-wrap gap-3 border-t border-line pt-6">
            {med.is_private ? (
              <form action={setMedicationPrivacy}>
                <input type="hidden" name="medication_id" value={med.id} />
                <button
                  type="submit"
                  className="rounded-md border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-surface"
                >
                  Make visible to caregivers
                </button>
              </form>
            ) : (
              <form action={setMedicationPrivacy}>
                <input type="hidden" name="medication_id" value={med.id} />
                <input type="hidden" name="is_private" value="on" />
                <button
                  type="submit"
                  className="rounded-md border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-surface"
                >
                  Make private
                </button>
              </form>
            )}
            <RemoveMedicationControls medicationId={med.id} doseCount={doseCount} />
          </section>
        ) : null}
      </main>
    </div>
  );
}
