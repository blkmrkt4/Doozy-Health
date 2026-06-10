"use client";

import { useEffect, useRef, useState } from "react";
import { createMedication } from "@/app/medications/actions";
import { DrugSearch } from "./drug-search";
import {
  StatusMark,
  type RowStatus,
  type CheckItem,
  type SetupStatus,
} from "./setup-status";
import {
  DILUENTS,
  DOSE_UNITS,
  FORM_TYPES,
  FORM_TYPE_LABELS,
  FREQUENCY_PERIODS,
  FREQUENCY_UNITS,
  INJECTABLE_FORM_TYPES,
  ROUTES,
  ROUTE_LABELS,
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

type FreqType = "every" | "times_per" | "as_needed";

type FreqInit = {
  type?: FreqType;
  interval?: number;
  unit?: string;
  count?: number;
  period?: string;
};

function FrequencyFields({
  prefix,
  value,
  onChange,
  init,
}: {
  prefix: string;
  value: FreqType;
  onChange: (v: FreqType) => void;
  init?: FreqInit;
}) {
  return (
    <div className="space-y-3">
      <label className={labelCls}>
        How often
        <select
          name={`${prefix}_type`}
          value={value}
          onChange={(e) => onChange(e.target.value as FreqType)}
          className={inputCls}
        >
          <option value="every">Every…</option>
          <option value="times_per">A number of times per…</option>
          <option value="as_needed">As needed (PRN)</option>
        </select>
      </label>

      {value === "every" ? (
        <div className="flex gap-3">
          <label className={`${labelCls} flex-1`}>
            Interval
            <input
              type="number"
              name={`${prefix}_interval`}
              min={1}
              step={1}
              defaultValue={init?.interval ?? 1}
              className={`${inputCls} tabular`}
            />
          </label>
          <label className={`${labelCls} flex-1`}>
            Unit
            <select
              name={`${prefix}_unit`}
              defaultValue={init?.unit ?? "week"}
              className={inputCls}
            >
              {FREQUENCY_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {value === "times_per" ? (
        <div className="flex gap-3">
          <label className={`${labelCls} flex-1`}>
            Times
            <input
              type="number"
              name={`${prefix}_count`}
              min={1}
              step={1}
              defaultValue={init?.count ?? 1}
              className={`${inputCls} tabular`}
            />
          </label>
          <label className={`${labelCls} flex-1`}>
            Per
            <select
              name={`${prefix}_period`}
              defaultValue={init?.period ?? "week"}
              className={inputCls}
            >
              {FREQUENCY_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}

function DoseFields({
  prefix,
  amount,
  unit,
}: {
  prefix: string;
  amount?: string;
  unit?: string;
}) {
  return (
    <div className="flex gap-3">
      <label className={`${labelCls} flex-1`}>
        Dose amount
        <input
          type="number"
          name={`${prefix}_dose_amount`}
          min={0}
          step="any"
          defaultValue={amount}
          className={`${inputCls} tabular`}
        />
      </label>
      <label className={`${labelCls} w-28`}>
        Unit
        <select
          name={`${prefix}_dose_unit`}
          defaultValue={unit ?? "mg"}
          className={inputCls}
        >
          {DOSE_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function RouteField({ prefix, route }: { prefix: string; route?: string }) {
  return (
    <label className={labelCls}>
      Route
      <select
        name={`${prefix}_route`}
        defaultValue={route ?? "oral"}
        className={inputCls}
      >
        {ROUTES.map((r) => (
          <option key={r} value={r}>
            {ROUTE_LABELS[r]}
          </option>
        ))}
      </select>
    </label>
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
    freq?: FreqInit;
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
    freq?: FreqInit;
    reasonNote?: string;
  };
};

// Shared create/edit form (PRD §5.2.1, §5.3). In edit mode it is pre-filled
// with the current values and posts to `updateMedication`; the prescribed
// regimen and delivery form are versioned (new rows), the chosen regimen is
// updated in place.
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
  const [prescribedFreq, setPrescribedFreq] = useState<FreqType>(
    init.prescribed?.freq?.type ?? "every"
  );
  const [chosenFreq, setChosenFreq] = useState<FreqType>(
    init.chosen?.freq?.type ?? "every"
  );
  // Default to a tablet, not a vial: most medications are oral, and defaulting
  // to an injectable form wrongly pulls in concentration + syringe (and a syringe
  // on the setup checklist) for something like aspirin.
  const [formType, setFormType] = useState<FormType>(
    init.delivery?.formType ?? "tablet"
  );
  const [choseDiffers, setChoseDiffers] = useState(init.chosen?.differs ?? false);

  const showSyringe = INJECTABLE_FORM_TYPES.has(formType);

  // Live checklist status — read from the form on each input (fields stay
  // uncontrolled). Green ticks appear as each component is filled in.
  const formRef = useRef<HTMLFormElement>(null);
  const [st, setSt] = useState({
    name: Boolean(init.drugName),
    prescription: Number(init.prescribed?.doseAmount ?? 0) > 0,
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
    setSt({
      name: v("drug_name").trim().length > 0,
      prescription: n("prescribed_dose_amount") > 0,
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
  const prescriptionStatus: RowStatus = st.prescription ? "done" : "todo";
  const labelStatus: RowStatus = st.label ? "done" : "optional";
  const syringeStatus: RowStatus = st.syringe ? "done" : "optional";
  const diluentStatus: RowStatus = !st.isRecon ? "na" : st.mixVolume ? "done" : "optional";

  // The bottom line: do we have enough to start logging? The server requires
  // only a name + a complete prescribed regimen; everything else is optional.
  const ready = st.name && st.prescription;

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
      context: "Optional — makes the modelled chart truer.",
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
      onInput={recompute}
      onChange={recompute}
      className="space-y-3"
    >
      {medicationId ? (
        <input type="hidden" name="medication_id" value={medicationId} />
      ) : null}

      {/* Identity — always visible (the name is the identifier). */}
      <div className="space-y-3 rounded-md border border-line p-4">
        <DrugSearch
          initialName={init.drugName}
          initialCanonicalId={init.canonicalDrugId}
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
        title="Prescription — dose, units & schedule"
        status={prescriptionStatus}
        defaultOpen
        hint="What the doctor wrote — the dose each time, its unit, and how often."
      >
        <DoseFields
          prefix="prescribed"
          amount={init.prescribed?.doseAmount}
          unit={init.prescribed?.doseUnit}
        />
        <RouteField prefix="prescribed" route={init.prescribed?.route} />
        <FrequencyFields
          prefix="prescribed_freq"
          value={prescribedFreq}
          onChange={setPrescribedFreq}
          init={init.prescribed?.freq}
        />
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
          <textarea name="directions" rows={2} placeholder="e.g. Take 1 tablet by mouth every morning" defaultValue={init.prescribed?.directions} className={inputCls} />
        </label>
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

      {/* How you take it (chosen). */}
      <Row
        title="How you take it"
        status={choseDiffers ? "optional" : "na"}
        hint="Defaults to the prescription — open only if you take it differently."
      >
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="chosen_differs" className="accent-accent" checked={choseDiffers} onChange={(e) => setChoseDiffers(e.target.checked)} />
          I take this differently from the prescription
        </label>
        {choseDiffers ? (
          <div className="space-y-4">
            <DoseFields prefix="chosen" amount={init.chosen?.doseAmount} unit={init.chosen?.doseUnit} />
            <RouteField prefix="chosen" route={init.chosen?.route} />
            <FrequencyFields prefix="chosen_freq" value={chosenFreq} onChange={setChosenFreq} init={init.chosen?.freq} />
            <label className={labelCls}>
              Reason (optional)
              <input type="text" name="chosen_reason_note" placeholder="e.g. split to flatten the curve" defaultValue={init.chosen?.reasonNote} className={inputCls} />
            </label>
          </div>
        ) : null}
      </Row>

      <div className="flex gap-3 pt-1">
        <button type="submit" className="block flex-1 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90">
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
