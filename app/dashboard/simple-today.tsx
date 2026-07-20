import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { quickLogDose } from "@/app/medications/actions";
import { acceptInvite, declineInvite } from "@/app/settings/caregivers/actions";
import { SimpleDoseCard } from "@/app/_components/simple-dose-card";
import { DiaryDayForm } from "@/app/_components/diary-day-form";
import { PatientSwitcher } from "@/app/_components/patient-switcher";
import { defaultDoseText, noonInput } from "@/lib/quick-log";
import type { SimpleTodayModel } from "@/lib/simple-today";
import type { MedLogMeta } from "@/lib/adherence";
import type { TrackedField, DiaryEntry } from "@/lib/types";

// Simple mode's Today view (users.display_prefs.simple_mode) — the whole
// dashboard reduced to: what is scheduled today, one big button per dose, the
// configured daily diary questions, and a quiet factual record of yesterday.
// No calendar wheel, charts, tabs, or amount editing; the full view keeps all
// of that. Copy states schedule facts, never instructions (PRD §6.1), and
// completion is stated plainly with no celebration (hard rule #14).

type PatientRef = {
  id: string;
  name: string;
  role: "owner" | "caregiver" | "viewer";
};

export async function SimpleToday({
  activePatient,
  allPatients,
  pendingInvites,
  canLog,
  model,
  medMeta,
  medsWithInteractions,
}: {
  activePatient: PatientRef | null;
  allPatients: PatientRef[];
  pendingInvites: {
    patientId: string;
    patientName: string;
    role: string;
    membershipId: string | null;
  }[];
  canLog: boolean;
  model: SimpleTodayModel;
  medMeta: Record<string, MedLogMeta>;
  medsWithInteractions: string[];
}) {
  // The daily check-in reuses the diary's tap-through controls; these queries
  // are the same light reads the full dashboard makes for its calendar twisty.
  const supabase = await createClient();
  let diaryFields: TrackedField[] = [];
  let todayEntry: DiaryEntry | null = null;
  if (activePatient) {
    const { data: tfRows } = await supabase
      .from("tracked_fields")
      .select("id, name, field_type, unit, category_options, cadence, display_order")
      .eq("patient_id", activePatient.id)
      .eq("active", true)
      .order("display_order");
    diaryFields = (tfRows ?? []) as TrackedField[];

    if (model.todayKey) {
      const { data: entryRow } = await supabase
        .from("diary_entries")
        .select("id, entry_at, entry_date, field_values, note")
        .eq("patient_id", activePatient.id)
        .eq("entry_date", model.todayKey)
        .maybeSingle();
      todayEntry = (entryRow as DiaryEntry | null) ?? null;
    }
  }

  const interactions = new Set(medsWithInteractions);
  const hasMeds =
    model.remaining.length + model.done.length + model.unscheduled.length > 0;
  const todayLabel = new Date(model.todayMs || Date.now()).toLocaleDateString(
    "en-US",
    { weekday: "long", month: "long", day: "numeric" }
  );
  const medName = (id: string) => medMeta[id]?.name ?? "Medication";

  return (
    <div className="min-h-full">
      <main className="mx-auto max-w-2xl px-5 py-8">
        {/* Date header + patient context. */}
        <header>
          <h1 className="text-3xl font-medium tracking-tight text-paper">
            {todayLabel}
          </h1>
          {activePatient &&
          (allPatients.length > 1 || activePatient.role !== "owner") ? (
            <div className="mt-2 text-base text-muted">
              {allPatients.length > 1 ? (
                <PatientSwitcher
                  patients={allPatients}
                  activeId={activePatient.id}
                />
              ) : (
                <span className="blur-private">
                  {activePatient.name}
                  <span className="ml-1 text-faint">({activePatient.role})</span>
                </span>
              )}
            </div>
          ) : null}
        </header>

        {/* Pending invites still surface here — accepting one is how a family
            member starts helping (PRD §4.5). */}
        {pendingInvites.length > 0 ? (
          <section className="mt-6 space-y-3 rounded-xl border border-line p-5">
            <h2 className="text-lg font-medium text-paper">Invitations</h2>
            {pendingInvites.map((inv) => (
              <div key={inv.patientId} className="space-y-2">
                <p className="text-base text-muted">
                  <span className="text-paper blur-private">
                    {inv.patientName}
                  </span>{" "}
                  — invited as {inv.role}
                </p>
                {inv.membershipId ? (
                  <div className="flex gap-2">
                    <form action={acceptInvite}>
                      <input
                        type="hidden"
                        name="membership_id"
                        value={inv.membershipId}
                      />
                      <button
                        type="submit"
                        className="rounded-lg bg-accent px-5 py-2.5 text-base font-medium text-on-accent hover:opacity-90"
                      >
                        Accept
                      </button>
                    </form>
                    <form action={declineInvite}>
                      <input
                        type="hidden"
                        name="membership_id"
                        value={inv.membershipId}
                      />
                      <button
                        type="submit"
                        className="rounded-lg border border-line px-5 py-2.5 text-base text-muted hover:bg-surface"
                      >
                        Decline
                      </button>
                    </form>
                  </div>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        {!hasMeds ? (
          <section className="mt-8 rounded-xl border border-dashed border-line px-6 py-14 text-center">
            <p className="text-lg text-muted">No medications yet.</p>
            <p className="mt-2 text-base text-faint">
              Medications are added from the full view — switch in Settings.
            </p>
          </section>
        ) : null}

        {/* Scheduled today, still unlogged. */}
        {model.remaining.length > 0 ? (
          <section className="mt-8 space-y-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-faint">
              Scheduled today
            </h2>
            {model.remaining.map((d) => (
              <SimpleDoseCard
                key={d.medId}
                meta={medMeta[d.medId]}
                scheduled={d.scheduled}
                logged={d.logged}
                logIds={d.logIds}
                dayMs={model.todayMs}
                canLog={canLog}
                hasInteraction={interactions.has(d.medId)}
              />
            ))}
          </section>
        ) : null}

        {/* All-done: a plain statement of the record, nothing more. */}
        {hasMeds && model.remaining.length === 0 && model.done.length > 0 ? (
          <p className="mt-8 rounded-xl border border-line p-5 text-lg text-muted">
            Every scheduled dose today is logged.
          </p>
        ) : null}

        {/* Logged today — the quiet completed list. */}
        {model.done.length > 0 ? (
          <section className="mt-8 space-y-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-faint">
              Logged today
            </h2>
            {model.done.map((d) => (
              <SimpleDoseCard
                key={d.medId}
                meta={medMeta[d.medId]}
                scheduled={d.scheduled}
                logged={d.logged}
                logIds={d.logIds}
                dayMs={model.todayMs}
                canLog={canLog}
                hasInteraction={interactions.has(d.medId)}
              />
            ))}
          </section>
        ) : null}

        {/* Yesterday's factual shortfall — an offer to complete the record,
            never a judgement. Past days may be recorded plainly (§6.1). */}
        {canLog && model.yesterday ? (
          <section className="mt-8 rounded-xl border border-line p-5">
            <h2 className="text-lg font-medium text-paper">Yesterday</h2>
            <div className="mt-2 space-y-3">
              {model.yesterday.shortfalls.map((s) => {
                const meta = medMeta[s.medId];
                const { doseText } = defaultDoseText(meta);
                const syringeNote =
                  meta.isInjectable &&
                  meta.concentrationAmount != null &&
                  meta.concentrationAmount > 0
                    ? `${doseText} mL drawn`
                    : null;
                return (
                  <div
                    key={s.medId}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <p className="text-base text-muted">
                      <span className="text-paper blur-private">
                        {medName(s.medId)}
                      </span>{" "}
                      — {s.logged} of {s.scheduled} scheduled{" "}
                      {s.scheduled === 1 ? "dose was" : "doses were"} logged.
                    </p>
                    <form action={quickLogDose}>
                      <input type="hidden" name="medication_id" value={s.medId} />
                      <input
                        type="hidden"
                        name="amount"
                        value={String(meta.defaultAmount)}
                      />
                      <input type="hidden" name="unit" value={meta.defaultUnit} />
                      <input
                        type="hidden"
                        name="route_taken"
                        value={meta.defaultRoute}
                      />
                      {syringeNote ? (
                        <input type="hidden" name="note" value={syringeNote} />
                      ) : null}
                      <input
                        type="hidden"
                        name="logged_at"
                        value={noonInput(model.yesterday!.dayMs)}
                      />
                      <button
                        type="submit"
                        className="rounded-lg border border-line px-4 py-2 text-base text-muted hover:bg-surface hover:text-paper"
                      >
                        Add an entry for yesterday
                      </button>
                    </form>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* Not scheduled today — as-needed and off-cadence medications. */}
        {model.unscheduled.length > 0 ? (
          <details className="mt-8 rounded-xl border border-line">
            <summary className="cursor-pointer list-none px-5 py-4 text-lg text-muted">
              Other medications ({model.unscheduled.length})
            </summary>
            <div className="space-y-3 border-t border-line p-5">
              <p className="text-sm text-faint">Not scheduled today.</p>
              {model.unscheduled.map((d) => (
                <SimpleDoseCard
                  key={d.medId}
                  meta={medMeta[d.medId]}
                  scheduled={d.scheduled}
                  logged={d.logged}
                  logIds={d.logIds}
                  dayMs={model.todayMs}
                  canLog={canLog}
                  hasInteraction={interactions.has(d.medId)}
                />
              ))}
            </div>
          </details>
        ) : null}

        {/* Daily check-in — the diary questions the patient chose to be asked. */}
        {activePatient && diaryFields.length > 0 && model.todayKey ? (
          <section className="mt-8 rounded-xl border border-line p-5">
            <h2 className="mb-4 text-lg font-medium text-paper">How is today?</h2>
            <DiaryDayForm
              dayDate={model.todayKey}
              fields={diaryFields}
              entry={todayEntry}
              medNames={Object.fromEntries(
                Object.values(medMeta).map((m) => [m.medId, m.name])
              )}
              canLog={canLog}
              simple
            />
          </section>
        ) : null}

        {/* The escape hatch lives behind Settings — two taps, hard to hit by
            accident, and the same place the mode was turned on. */}
        <p className="mt-10 text-center text-base text-faint">
          Looking for the calendar and charts?{" "}
          <Link href="/settings" className="underline hover:text-muted">
            Switch views in Settings
          </Link>
        </p>
      </main>
    </div>
  );
}
