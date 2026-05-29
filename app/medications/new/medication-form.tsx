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

function FrequencyFields({
  prefix,
  value,
  onChange,
}: {
  prefix: string;
  value: FreqType;
  onChange: (v: FreqType) => void;
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
              defaultValue={1}
              className={`${inputCls} tabular`}
            />
          </label>
          <label className={`${labelCls} flex-1`}>
            Unit
            <select name={`${prefix}_unit`} defaultValue="week" className={inputCls}>
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
              defaultValue={1}
              className={`${inputCls} tabular`}
            />
          </label>
          <label className={`${labelCls} flex-1`}>
            Per
            <select name={`${prefix}_period`} defaultValue="week" className={inputCls}>
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

function DoseFields({ prefix }: { prefix: string }) {
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
          className={`${inputCls} tabular`}
        />
      </label>
      <label className={`${labelCls} w-28`}>
        Unit
        <select name={`${prefix}_dose_unit`} defaultValue="mg" className={inputCls}>
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

function RouteField({ prefix }: { prefix: string }) {
  return (
    <label className={labelCls}>
      Route
      <select name={`${prefix}_route`} defaultValue="oral" className={inputCls}>
        {ROUTES.map((r) => (
          <option key={r} value={r}>
            {ROUTE_LABELS[r]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MedicationForm() {
  const [prescribedFreq, setPrescribedFreq] = useState<FreqType>("every");
  const [chosenFreq, setChosenFreq] = useState<FreqType>("every");
  const [formType, setFormType] = useState<FormType>("vial");
  const [choseDiffers, setChoseDiffers] = useState(false);

  const showSyringe = INJECTABLE_FORM_TYPES.has(formType);

  return (
    <form action={createMedication} className="space-y-6">
      {/* Drug name (typeahead over the reference catalogue) + privacy */}
      <div className="space-y-4">
        <DrugSearch />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="is_private" className="accent-accent" />
          Keep this medication private (hidden from caregivers and viewers)
        </label>
      </div>

      {/* Prescribed regimen */}
      <fieldset className={sectionCls}>
        <legend className={legendCls}>What was prescribed</legend>
        <p className="text-xs text-faint">
          What the doctor wrote — the prescription of record.
        </p>
        <DoseFields prefix="prescribed" />
        <RouteField prefix="prescribed" />
        <FrequencyFields
          prefix="prescribed_freq"
          value={prescribedFreq}
          onChange={setPrescribedFreq}
        />
        <div className="flex gap-3">
          <label className={`${labelCls} flex-1`}>
            Duration (days, optional)
            <input
              type="number"
              name="prescribed_duration_days"
              min={1}
              step={1}
              className={`${inputCls} tabular`}
            />
          </label>
          <label className={`${labelCls} flex-1`}>
            Prescriber (optional)
            <input type="text" name="prescriber_name" className={inputCls} />
          </label>
        </div>
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
                className={`${inputCls} tabular`}
              />
            </label>
            <label className={`${labelCls} w-24`}>
              Unit
              <select name="conc_unit" defaultValue="mg" className={inputCls}>
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
                defaultValue={1}
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
              className={`${inputCls} tabular`}
            />
          </label>
          <label className={`${labelCls} flex-1`}>
            Pack unit (optional)
            <input
              type="text"
              name="package_unit"
              placeholder="e.g. tablets, mL"
              className={inputCls}
            />
          </label>
        </div>

        {showSyringe ? (
          <div className="space-y-2 rounded-md border border-line p-3">
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
                  className={`${inputCls} tabular`}
                />
              </label>
              <label className={`${labelCls} flex-1`}>
                Unit markings
                <input
                  type="text"
                  name="syringe_unit_markings"
                  placeholder="e.g. 0.1 mL"
                  className={inputCls}
                />
              </label>
            </div>
          </div>
        ) : null}

        <div className="flex gap-3">
          <label className={`${labelCls} flex-1`}>
            Expiry (optional)
            <input type="date" name="expiry_date" className={inputCls} />
          </label>
          <label className={`${labelCls} flex-1`}>
            Batch (optional)
            <input type="text" name="batch" className={inputCls} />
          </label>
        </div>
        <label className={labelCls}>
          Manufacturer (optional)
          <input type="text" name="manufacturer" className={inputCls} />
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
            <DoseFields prefix="chosen" />
            <RouteField prefix="chosen" />
            <FrequencyFields
              prefix="chosen_freq"
              value={chosenFreq}
              onChange={setChosenFreq}
            />
            <label className={labelCls}>
              Reason (optional)
              <input
                type="text"
                name="chosen_reason_note"
                placeholder="e.g. split to flatten the curve"
                className={inputCls}
              />
            </label>
          </div>
        ) : null}
      </fieldset>

      <button
        type="submit"
        className="block w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-ink transition-opacity hover:opacity-90"
      >
        Save medication
      </button>
    </form>
  );
}
