"use client";

import { useEffect, useRef, useState } from "react";
import { createMedication } from "@/app/medications/actions";
import { DrugSearch } from "@/app/medications/new/drug-search";
import { RegimenFields, type FrequencyInitial } from "@/app/medications/_components/regimen-fields";
import { describePlan, weeklyTotal, readableNumber, type RegimenInput } from "@/lib/regimen-plan";
import {
  StatusMark,
  type RowStatus,
  type CheckItem,
  type SetupStatus,
} from "@/app/medications/new/setup-status";
import {
  DILUENTS,
  DOSE_UNITS,
  FORM_TYPES,
  FORM_TYPE_LABELS,
  INJECTABLE_FORM_TYPES,
  type FormType,
} from "@/lib/types";

const inputCls =
  "mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-paper outline-none focus:border-accent";
const labelCls = "block text-sm text-muted";

/** One collapsible checklist row: a one-line summary that opens to its inputs.
 *  `id` anchors the row so the summary checklist can jump to it. */
function Row({
  id,
  title,
  status,
  defaultOpen,
  hint,
  children,
}: {
  id?: string;
  title: string;
  status: RowStatus;
  defaultOpen?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <details id={id} open={defaultOpen} className="scroll-mt-4 rounded-md border border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm">
        <span className="min-w-0 font-medium text-paper">{title}</span>
        <StatusMark status={status} size={18} />
      </summary>
      <div className="space-y-4 border-t border-line p-4">
        {hint ? <p className="text-xs text-faint">{hint}</p> : null}
        {children}
      </div>
    </details>
  );
}

export type MedicationFormInitial = {
  drugName?: string;
  canonicalDrugId?: string;
  isPrivate?: boolean;
  syringeId?: string;
  prescribed?: {
    doseAmount?: string;
    doseUnit?: string;
    route?: string;
    freq?: FrequencyInitial;
    durationDays?: string;
    prescriberName?: string;
    directions?: string;
  };
  delivery?: {
    formType?: FormType;
    concAmount?: string;
    concUnit?: string;
    concPerVolume?: string;
    packageCount?: string;
    packageUnit?: string;
    syringeCapacityMl?: string;
    syringeNeedleGauge?: string;
    syringeNeedleLengthIn?: string;
    syringeUnitMarkings?: string;
    expiryDate?: string;
    batch?: string;
    manufacturer?: string;
  };
  chosen?: {
    differs?: boolean;
    doseAmount?: string;
    doseUnit?: string;
    route?: string;
    freq?: FrequencyInitial;
    reasonNote?: string;
  };
};

// Shared create/edit form (PRD §5.2.1, §5.3). In edit mode it is pre-filled
// with the current values and posts to `updateMedication`; the prescribed
// regimen and delivery form are versioned (new rows), the chosen regimen is
// versioned too.
export function MedicationForm({
  action = createMedication,
  medicationId,
  submitLabel = "Save medication",
  cancelHref,
  initial,
  syringes,
  onStatus,
}: {
  action?: (formData: FormData) => void | Promise<void>;
  medicationId?: string;
  submitLabel?: string;
  cancelHref?: string;
  initial?: MedicationFormInitial;
  syringes?: { id: string; label: string }[];
  /** Reports the live setup status up so the page can render the checklist at
   *  the top, above the scan box. When omitted (edit screen), nothing is sent. */
  onStatus?: (status: SetupStatus) => void;
} = {}) {
  const init = initial ?? {};
  const [prescription, setPrescription] = useState<RegimenInput | null>(null);
  const [chosenPlan, setChosenPlan] = useState<RegimenInput | null>(null);
  const [planMode, setPlanMode] = useState<"same" | "split" | "custom">(
    init.chosen?.differs ? "custom" : "same"
  );
  const [confirmed, setConfirmed] = useState(false);
  const [nameText, setNameText] = useState(init.drugName ?? "");
  // Default to a tablet, not a vial: most medications are oral, and defaulting
  // to an injectable form wrongly pulls in concentration + syringe (and a syringe
  // on the setup checklist) for something like aspirin.
  const [formType, setFormType] = useState<FormType>(
    init.delivery?.formType ?? "tablet"
  );
  const choseDiffers = planMode !== "same";
  const activePlan = choseDiffers ? chosenPlan : prescription;

  const showSyringe = INJECTABLE_FORM_TYPES.has(formType);

  // Live checklist status — read the optional fields from the form after
  // their change handlers run. Green ticks appear as each component is filled in.
  const formRef = useRef<HTMLFormElement>(null);
  const [st, setSt] = useState({
    label: Number(init.delivery?.concAmount ?? 0) > 0,
    syringe: Boolean(init.syringeId) || Number(init.delivery?.syringeCapacityMl ?? 0) > 0,
    isRecon: false,
    mixVolume: Number(init.delivery?.concPerVolume ?? 0) > 0,
  });
  function recompute() {
    const f = formRef.current;
    if (!f) return;
    const fd = new FormData(f);
    const n = (k: string) => Number(fd.get(k) ?? 0);
    const v = (k: string) => String(fd.get(k) ?? "");
    setNameText(v("drug_name"));
    setSt({
      label: n("conc_amount") > 0,
      syringe: !!v("syringe_id") || n("syringe_capacity_ml") > 0,
      isRecon: fd.get("is_reconstituted") === "on",
      mixVolume: n("conc_per_volume") > 0,
    });
  }
  // Recompute on mount and when the form type / chosen toggle changes rows.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(recompute, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(recompute, [formType, choseDiffers]);

  // Status tiers (PRD §5.2): red ✕ only for what the app can't work without —
  // the prescribed regimen. Yellow ! for "works, but better info helps" (the
  // label's strength, the syringe size, a powder's mix volume). Green ✓ when
  // done, and it then goes quiet.
  const prescriptionStatus: RowStatus = prescription ? "done" : "todo";
  const labelStatus: RowStatus = st.label ? "done" : "optional";
  const syringeStatus: RowStatus = st.syringe ? "done" : "optional";
  const diluentStatus: RowStatus = !st.isRecon ? "na" : st.mixVolume ? "done" : "optional";

  // The bottom line: do we have enough to start logging? The server requires
  // only a name + a complete prescribed regimen; everything else is optional.
  const ready = nameText.trim().length > 0 && !!prescription && !!activePlan;
  const prescriptionTotal = prescription ? weeklyTotal(prescription) : null;
  const chosenTotal = activePlan ? weeklyTotal(activePlan) : null;
  const summary = activePlan ? describePlan(activePlan, nameText) : "Complete the amount and schedule to see your plan here.";
  useEffect(() => setConfirmed(false), [activePlan, prescription, nameText]);

  // The at-a-glance list of what THIS product needs. It adapts to what we know:
  // a syringe (and a powder's mixing water) only appear once the form reads as
  // an injectable — so a freshly-opened form shows just the document + the
  // container, never a syringe for a pill.
  // Information-framed, not document-framed: what we need to *know* to start,
  // and which a prescription OR a bottle/vial label (or typing) can supply —
  // so neither document is "required" over the other. Only the dose & schedule
  // is needed to begin; the strength just sharpens the chart.
  const checklist: CheckItem[] = [
    {
      key: "prescription",
      href: "#row-prescription",
      label: "What to take & how often",
      context: "Scan a prescription or the bottle label — or type it in.",
      status: prescriptionStatus,
    },
    {
      key: "label",
      href: "#row-label",
      label: "Strength on the label",
      context: "Highly recommended for accuracy.",
      status: labelStatus,
    },
  ];
  if (showSyringe) {
    checklist.push({
      key: "syringe",
      href: "#row-syringe",
      label: "Syringe — its size in mL",
      context: "Works without it — shows the fill line.",
      status: syringeStatus,
    });
    if (st.isRecon) {
      checklist.push({
        key: "diluent",
        href: "#row-diluent",
        label: "Bacteriostatic water for mixing",
        context: "Add the mix volume — the concentration is worked out from it.",
        status: diluentStatus,
      });
    }
  }

  // Report status up so the page can render the checklist at the very top. A
  // signature guard keeps this from looping (parent re-render → same payload).
  const lastSent = useRef("");
  useEffect(() => {
    if (!onStatus) return;
    const payload: SetupStatus = { items: checklist, ready };
    const sig = JSON.stringify(payload);
    if (sig !== lastSent.current) {
      lastSent.current = sig;
      onStatus(payload);
    }
  });

  return (
    <form
      ref={formRef}
      action={action}
      // Native selects emit input before change. Re-rendering on input restores
      // their old controlled value before the field's onChange can record it.
      onChange={(e) => {
        recompute();
        if (!(e.target instanceof HTMLInputElement && e.target.name === "plan_confirmed")) {
          setConfirmed(false);
        }
      }}
      className="space-y-3"
    >
      {medicationId ? (
        <input type="hidden" name="medication_id" value={medicationId} />
      ) : null}

      <input type="hidden" name="plan_review_required" value="on" />
      {choseDiffers && <input type="hidden" name="chosen_differs" value="on" />}
      {/* Identity — always visible (the name is the identifier). */}
      <div className="space-y-3 rounded-md border border-line p-4">
        <DrugSearch
          initialName={init.drugName}
          initialCanonicalId={init.canonicalDrugId}
          onNameChange={setNameText}
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            name="is_private"
            defaultChecked={init.isPrivate}
            className="accent-accent"
          />
          Keep this medication private (hidden from caregivers and viewers)
        </label>
      </div>

      {/* The at-a-glance checklist renders at the top of the page (above the
          scan box) from the status reported via onStatus. Here are the rows to
          fill each item in. */}
      <p className="px-1 text-xs text-faint">
        Open any item below to fill it in. Add what you have now; you can always
        come back for the rest.
      </p>

      {/* Prescription */}
      <Row
        id="row-prescription"
        title="1. What does the prescription say?"
        status={prescriptionStatus}
        defaultOpen
        hint="Enter the amount and timing written on the prescription. Your chosen schedule comes next."
      >
        <RegimenFields prefix="prescribed" initial={init.prescribed} onPlanChange={setPrescription} />
        <details className="rounded-md border border-line p-3">
          <summary className="cursor-pointer text-sm text-muted">Optional prescription details</summary>
          <div className="mt-3 space-y-3">
        <div className="flex gap-3">
          <label className={`${labelCls} flex-1`}>
            Duration (days, optional)
            <input type="number" name="prescribed_duration_days" min={1} step={1} defaultValue={init.prescribed?.durationDays} className={`${inputCls} tabular`} />
          </label>
          <label className={`${labelCls} flex-1`}>
            Prescriber (optional)
            <input type="text" name="prescriber_name" defaultValue={init.prescribed?.prescriberName} className={inputCls} />
          </label>
        </div>
        <label className={labelCls}>
          Directions (optional)
          <textarea name="directions" rows={2} placeholder="Copy any additional wording from the label" defaultValue={init.prescribed?.directions} className={inputCls} />
        </label>
          </div>
        </details>
      </Row>

      <Row title="2. How have you chosen to take it?" status={activePlan ? "done" : "todo"} defaultOpen>
        <div className="space-y-2">
          {([
            ["same", "As written on the prescription"],
            ["split", "Divide a weekly total across days I choose"],
            ["custom", "Enter my own amount and schedule"],
          ] as const).map(([value, text]) => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-line px-3 py-2 text-sm text-paper">
            <input type="radio" name="plan_mode" value={value} checked={planMode === value} onChange={() => { setPlanMode(value); setConfirmed(false); }} className="accent-accent" />{text}
          </label>)}
        </div>
        {choseDiffers && <RegimenFields
          key={planMode}
          prefix="chosen"
          split={planMode === "split"}
          initial={planMode === "split" ? {
            doseUnit: prescription?.dose_unit, route: prescription?.route,
            freq: { type: "weekly", weekly_total: prescriptionTotal ?? undefined },
          } : init.chosen?.differs ? init.chosen : {
            doseAmount: prescription ? String(prescription.dose_amount) : undefined,
            doseUnit: prescription?.dose_unit, route: prescription?.route, freq: prescription?.frequency,
          }}
          onPlanChange={setChosenPlan}
        />}
        {choseDiffers && prescriptionTotal != null && chosenTotal != null && <p className="text-sm text-muted">
          {prescription?.dose_unit === activePlan?.dose_unit
            ? Math.abs(prescriptionTotal - chosenTotal) < 1e-8
              ? `Same weekly total: ${readableNumber(chosenTotal)} ${activePlan?.dose_unit}.`
              : `Prescription: ${readableNumber(prescriptionTotal)} ${prescription?.dose_unit} per week. Your chosen plan: ${readableNumber(chosenTotal)} ${activePlan?.dose_unit} per week.`
            : `Prescription and chosen plan use different units: ${prescription?.dose_unit} and ${activePlan?.dose_unit}.`}
        </p>}
        {choseDiffers && <label className={labelCls}>Note about your plan (optional)<input type="text" name="chosen_reason_note" defaultValue={init.chosen?.reasonNote} className={inputCls} /></label>}
      </Row>

      {/* Medication label — form + strength */}
      <Row
        id="row-label"
        title="Medication label — form & strength"
        status={labelStatus}
        hint="The physical thing — pick the form, and its strength if you have it."
      >
        <label className={labelCls}>
          Form
          <select name="form_type" value={formType} onChange={(e) => setFormType(e.target.value as FormType)} className={inputCls}>
            {FORM_TYPES.map((f) => (<option key={f} value={f}>{FORM_TYPE_LABELS[f]}</option>))}
          </select>
        </label>
        <div className="space-y-2">
          <p className="text-xs text-faint">
            {showSyringe
              ? "Concentration — or, for a powder, the active amount in the vial"
              : "Strength (optional)"}
          </p>
          <div className="flex items-end gap-2">
            <label className={`${labelCls} flex-1`}>
              Amount
              <input type="number" name="conc_amount" min={0} step="any" defaultValue={init.delivery?.concAmount} className={`${inputCls} tabular`} />
            </label>
            <label className={`${labelCls} w-24`}>
              Unit
              <select name="conc_unit" defaultValue={init.delivery?.concUnit ?? "mg"} className={inputCls}>
                {DOSE_UNITS.map((u) => (<option key={u} value={u}>{u}</option>))}
              </select>
            </label>
            <span className="pb-2 text-sm text-faint">per</span>
            <label className={`${labelCls} w-20`}>
              Volume
              <input type="number" name="conc_per_volume" min={0} step="any" defaultValue={init.delivery?.concPerVolume ?? 1} className={`${inputCls} tabular`} />
            </label>
            <span className="pb-2 text-sm text-faint">mL</span>
          </div>
        </div>
        <div className="flex gap-3">
          <label className={`${labelCls} flex-1`}>
            Pack count (optional)
            <input type="number" name="package_count" min={0} step="any" defaultValue={init.delivery?.packageCount} className={`${inputCls} tabular`} />
          </label>
          <label className={`${labelCls} flex-1`}>
            Pack unit (optional)
            <input type="text" name="package_unit" placeholder="e.g. tablets, mL" defaultValue={init.delivery?.packageUnit} className={inputCls} />
          </label>
        </div>
        <div className="flex gap-3">
          <label className={`${labelCls} flex-1`}>
            Expiry (optional)
            <input type="date" name="expiry_date" defaultValue={init.delivery?.expiryDate} className={inputCls} />
          </label>
          <label className={`${labelCls} flex-1`}>
            Batch (optional)
            <input type="text" name="batch" defaultValue={init.delivery?.batch} className={inputCls} />
          </label>
        </div>
        <label className={labelCls}>
          Manufacturer (optional)
          <input type="text" name="manufacturer" defaultValue={init.delivery?.manufacturer} className={inputCls} />
        </label>
      </Row>

      {/* Reconstitution — injectables only (a powder is mixed before use). */}
      {showSyringe ? (
        <Row
          id="row-diluent"
          title="Reconstitution — powder + diluent"
          status={diluentStatus}
          hint="Only if this vial is a powder you mix before use (e.g. hCG, a peptide)."
        >
          <label className="flex items-start gap-2 text-sm text-muted">
            <input type="checkbox" name="is_reconstituted" defaultChecked={st.isRecon} className="mt-0.5" />
            <span>This vial is a powder I mix before use</span>
          </label>
          <p className="text-xs text-faint">
            Put the active amount in the vial in <span className="text-muted">Amount</span>{" "}
            under &ldquo;Medication label&rdquo;, and the volume your prescription says to
            add in <span className="text-muted">Volume</span> — the concentration is
            amount ÷ volume. The mix volume comes from your prescription, not from us.
          </p>
          <label className={labelCls}>
            Diluent
            <select name="diluent_type" defaultValue="bacteriostatic water" className={inputCls}>
              {DILUENTS.map((d) => (<option key={d} value={d}>{d}</option>))}
            </select>
          </label>
        </Row>
      ) : null}

      {/* Syringe — injectables only. */}
      {showSyringe ? (
        <Row
          id="row-syringe"
          title="Syringe"
          status={syringeStatus}
          hint="Pick the syringe you'll use (or add one) — its size shows the fill line."
        >
          <label className={labelCls}>
            Syringe (from your inventory)
            <select name="syringe_id" defaultValue={init.syringeId ?? ""} className={inputCls}>
              <option value="">— none —</option>
              {(syringes ?? []).map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
            </select>
            <span className="mt-1 block text-xs text-faint">
              Drives the calibrated syringe size.{" "}
              <a href="/inventory/new" className="text-accent hover:underline">Add a syringe</a>.
            </span>
          </label>
          <div className="flex gap-3">
            <label className={`${labelCls} flex-1`}>
              Capacity (mL)
              <input type="number" name="syringe_capacity_ml" min={0} step="any" defaultValue={init.delivery?.syringeCapacityMl} className={`${inputCls} tabular`} />
            </label>
            <label className={`${labelCls} flex-1`}>
              Needle gauge
              <input type="number" name="syringe_needle_gauge" min={0} step={1} defaultValue={init.delivery?.syringeNeedleGauge} className={`${inputCls} tabular`} />
            </label>
          </div>
          <div className="flex gap-3">
            <label className={`${labelCls} flex-1`}>
              Needle length (in)
              <input type="number" name="syringe_needle_length_in" min={0} step="any" defaultValue={init.delivery?.syringeNeedleLengthIn} className={`${inputCls} tabular`} />
            </label>
            <label className={`${labelCls} flex-1`}>
              Unit markings
              <input type="text" name="syringe_unit_markings" placeholder="e.g. 0.1 mL" defaultValue={init.delivery?.syringeUnitMarkings} className={inputCls} />
            </label>
          </div>
        </Row>
      ) : null}

      <section className="space-y-3 rounded-md border border-line border-l-4 border-l-accent bg-surface p-4" aria-labelledby="plan-readback-heading">
        <h2 id="plan-readback-heading" className="text-base font-medium text-paper">Your chosen plan</h2>
        <p aria-live="polite" className="blur-private text-lg leading-relaxed text-paper">{summary}</p>
        <label className="flex min-h-11 items-center gap-3 text-sm text-paper">
          <input type="checkbox" name="plan_confirmed" required disabled={!ready} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-5 w-5 accent-accent" />
          Yes, this describes the plan I entered.
        </label>
      </section>

      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={!ready || !confirmed} className="disabled:opacity-50 block flex-1 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90">
          {submitLabel}
        </button>
        {cancelHref ? (
          <a href={cancelHref} className="rounded-md border border-line px-4 py-2.5 text-sm text-muted transition-colors hover:bg-surface">
            Cancel
          </a>
        ) : null}
      </div>
    </form>
  );
}
