"use client";

import { useState } from "react";
import { createMedication } from "@/app/medications/actions";
import { DrugSearch } from "./drug-search";
import {
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
const sectionCls = "rounded-md border border-line p-4 space-y-4";
const legendCls = "text-sm font-medium text-paper";

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
          required
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
}: {
  action?: (formData: FormData) => void | Promise<void>;
  medicationId?: string;
  submitLabel?: string;
  cancelHref?: string;
  initial?: MedicationFormInitial;
  syringes?: { id: string; label: string }[];
} = {}) {
  const init = initial ?? {};
  const [prescribedFreq, setPrescribedFreq] = useState<FreqType>(
    init.prescribed?.freq?.type ?? "every"
  );
  const [chosenFreq, setChosenFreq] = useState<FreqType>(
    init.chosen?.freq?.type ?? "every"
  );
  const [formType, setFormType] = useState<FormType>(
    init.delivery?.formType ?? "vial"
  );
  const [choseDiffers, setChoseDiffers] = useState(init.chosen?.differs ?? false);

  const showSyringe = INJECTABLE_FORM_TYPES.has(formType);

  return (
    <form action={action} className="space-y-6">
      {medicationId ? (
        <input type="hidden" name="medication_id" value={medicationId} />
      ) : null}
      {/* Drug name (typeahead over the reference catalogue) + privacy */}
      <div className="space-y-4">
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

      {/* Prescribed regimen */}
      <fieldset className={sectionCls}>
        <legend className={legendCls}>What was prescribed</legend>
        <p className="text-xs text-faint">
          What the doctor wrote — the prescription of record.
        </p>
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
            <input
              type="number"
              name="prescribed_duration_days"
              min={1}
              step={1}
              defaultValue={init.prescribed?.durationDays}
              className={`${inputCls} tabular`}
            />
          </label>
          <label className={`${labelCls} flex-1`}>
            Prescriber (optional)
            <input
              type="text"
              name="prescriber_name"
              defaultValue={init.prescribed?.prescriberName}
              className={inputCls}
            />
          </label>
        </div>
        <label className={labelCls}>
          Directions (optional)
          <textarea
            name="directions"
            rows={2}
            placeholder="e.g. Take 1 tablet by mouth every morning"
            defaultValue={init.prescribed?.directions}
            className={inputCls}
          />
          <span className="mt-1 block text-xs text-faint">
            Kept with the medication so you — or a caregiver — can always see how
            it&rsquo;s meant to be taken.
          </span>
        </label>
      </fieldset>

      {/* Delivery form */}
      <fieldset className={sectionCls}>
        <legend className={legendCls}>What you have in hand</legend>
        <p className="text-xs text-faint">
          The physical thing — the vial, patch, or bottle and its strength.
        </p>
        <label className={labelCls}>
          Form
          <select
            name="form_type"
            value={formType}
            onChange={(e) => setFormType(e.target.value as FormType)}
            className={inputCls}
          >
            {FORM_TYPES.map((f) => (
              <option key={f} value={f}>
                {FORM_TYPE_LABELS[f]}
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-2">
          <p className="text-xs text-faint">Concentration (optional)</p>
          <div className="flex items-end gap-2">
            <label className={`${labelCls} flex-1`}>
              Amount
              <input
                type="number"
                name="conc_amount"
                min={0}
                step="any"
                defaultValue={init.delivery?.concAmount}
                className={`${inputCls} tabular`}
              />
            </label>
            <label className={`${labelCls} w-24`}>
              Unit
              <select
                name="conc_unit"
                defaultValue={init.delivery?.concUnit ?? "mg"}
                className={inputCls}
              >
                {DOSE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <span className="pb-2 text-sm text-faint">per</span>
            <label className={`${labelCls} w-20`}>
              Volume
              <input
                type="number"
                name="conc_per_volume"
                min={0}
                step="any"
                defaultValue={init.delivery?.concPerVolume ?? 1}
                className={`${inputCls} tabular`}
              />
            </label>
            <span className="pb-2 text-sm text-faint">mL</span>
          </div>
        </div>

        <div className="flex gap-3">
          <label className={`${labelCls} flex-1`}>
            Pack count (optional)
            <input
              type="number"
              name="package_count"
              min={0}
              step="any"
              defaultValue={init.delivery?.packageCount}
              className={`${inputCls} tabular`}
            />
          </label>
          <label className={`${labelCls} flex-1`}>
            Pack unit (optional)
            <input
              type="text"
              name="package_unit"
              placeholder="e.g. tablets, mL"
              defaultValue={init.delivery?.packageUnit}
              className={inputCls}
            />
          </label>
        </div>

        {showSyringe ? (
          <div className="space-y-2 rounded-md border border-line p-3">
            <label className={labelCls}>
              Syringe (from your inventory)
              <select
                name="syringe_id"
                defaultValue={init.syringeId ?? ""}
                className={inputCls}
              >
                <option value="">— none —</option>
                {(syringes ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-faint">
                Drives the calibrated syringe size.{" "}
                <a href="/inventory/new" className="text-accent hover:underline">
                  Add a syringe
                </a>
                .
              </span>
            </label>
            <p className="text-xs text-faint">
              Syringe details — used later to render the calibrated fill line.
            </p>
            <div className="flex gap-3">
              <label className={`${labelCls} flex-1`}>
                Capacity (mL)
                <input
                  type="number"
                  name="syringe_capacity_ml"
                  min={0}
                  step="any"
                  defaultValue={init.delivery?.syringeCapacityMl}
                  className={`${inputCls} tabular`}
                />
              </label>
              <label className={`${labelCls} flex-1`}>
                Needle gauge
                <input
                  type="number"
                  name="syringe_needle_gauge"
                  min={0}
                  step={1}
                  defaultValue={init.delivery?.syringeNeedleGauge}
                  className={`${inputCls} tabular`}
                />
              </label>
            </div>
            <div className="flex gap-3">
              <label className={`${labelCls} flex-1`}>
                Needle length (in)
                <input
                  type="number"
                  name="syringe_needle_length_in"
                  min={0}
                  step="any"
                  defaultValue={init.delivery?.syringeNeedleLengthIn}
                  className={`${inputCls} tabular`}
                />
              </label>
              <label className={`${labelCls} flex-1`}>
                Unit markings
                <input
                  type="text"
                  name="syringe_unit_markings"
                  placeholder="e.g. 0.1 mL"
                  defaultValue={init.delivery?.syringeUnitMarkings}
                  className={inputCls}
                />
              </label>
            </div>
          </div>
        ) : null}

        <div className="flex gap-3">
          <label className={`${labelCls} flex-1`}>
            Expiry (optional)
            <input
              type="date"
              name="expiry_date"
              defaultValue={init.delivery?.expiryDate}
              className={inputCls}
            />
          </label>
          <label className={`${labelCls} flex-1`}>
            Batch (optional)
            <input
              type="text"
              name="batch"
              defaultValue={init.delivery?.batch}
              className={inputCls}
            />
          </label>
        </div>
        <label className={labelCls}>
          Manufacturer (optional)
          <input
            type="text"
            name="manufacturer"
            defaultValue={init.delivery?.manufacturer}
            className={inputCls}
          />
        </label>
      </fieldset>

      {/* Chosen regimen */}
      <fieldset className={sectionCls}>
        <legend className={legendCls}>How you take it</legend>
        <p className="text-xs text-faint">
          Defaults to the prescription. Tick the box if you take it differently
          — this is what your schedule and timeline run from.
        </p>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            name="chosen_differs"
            className="accent-accent"
            checked={choseDiffers}
            onChange={(e) => setChoseDiffers(e.target.checked)}
          />
          I take this differently from the prescription
        </label>

        {choseDiffers ? (
          <div className="space-y-4">
            <DoseFields
              prefix="chosen"
              amount={init.chosen?.doseAmount}
              unit={init.chosen?.doseUnit}
            />
            <RouteField prefix="chosen" route={init.chosen?.route} />
            <FrequencyFields
              prefix="chosen_freq"
              value={chosenFreq}
              onChange={setChosenFreq}
              init={init.chosen?.freq}
            />
            <label className={labelCls}>
              Reason (optional)
              <input
                type="text"
                name="chosen_reason_note"
                placeholder="e.g. split to flatten the curve"
                defaultValue={init.chosen?.reasonNote}
                className={inputCls}
              />
            </label>
          </div>
        ) : null}
      </fieldset>

      <div className="flex gap-3">
        <button
          type="submit"
          className="block flex-1 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
        >
          {submitLabel}
        </button>
        {cancelHref ? (
          <a
            href={cancelHref}
            className="rounded-md border border-line px-4 py-2.5 text-sm text-muted transition-colors hover:bg-surface"
          >
            Cancel
          </a>
        ) : null}
      </div>
    </form>
  );
}
