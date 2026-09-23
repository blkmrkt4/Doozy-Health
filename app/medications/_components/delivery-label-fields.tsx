"use client";

import { useState } from "react";
import { DOSE_UNITS, type FormType } from "@/lib/types";

type LabelInitial = {
  formType?: FormType;
  concAmount?: string;
  concUnit?: string;
  concPerVolume?: string;
  packageCount?: string;
  packageUnit?: string;
};

const input = "mt-1 block min-h-11 w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-paper";
const label = "block text-sm text-muted";

function quantity(value: number): string {
  const rounded = Number(value.toPrecision(6));
  return `${rounded !== value ? "approximately " : ""}${rounded.toLocaleString("en-US", { maximumSignificantDigits: 6 })}`;
}

/** Vial volume still posts in the existing package fields (PRD §5.3). Keep it
 * separate from the volume printed in the concentration, which may be 1 mL. */
export function DeliveryLabelFields({ formType, initial = {}, onQuantityChange }: {
  formType: FormType;
  initial?: LabelInitial;
  onQuantityChange: () => void;
}) {
  const isVial = formType === "vial";
  const initialIsVolume = initial.packageUnit?.trim().toLowerCase() === "ml";
  const [amount, setAmount] = useState(initial.concAmount ?? "");
  const [unit, setUnit] = useState(initial.concUnit ?? "mg");
  const [perVolume, setPerVolume] = useState(initial.concPerVolume ?? "1");
  const [volume, setVolume] = useState(initialIsVolume ? initial.packageCount ?? "" : "");
  const [packCount, setPackCount] = useState(initial.packageCount ?? "");
  const [packUnit, setPackUnit] = useState(initial.packageUnit ?? "");
  // Never relabel an older count of vials (or a count without units) as mL.
  const [keepLegacyQuantity, setKeepLegacyQuantity] = useState(
    initial.formType === "vial" && !!initial.packageCount && !initialIsVolume
  );
  const useVialVolume = isVial && !keepLegacyQuantity;
  const perMl = Number(amount) / Number(perVolume);
  const validConcentration = Number(amount) > 0 && Number(perVolume) > 0 && Number.isFinite(perMl);
  const vialTotal = perMl * Number(volume);
  const validVolume = Number(volume) > 0 && Number.isFinite(vialTotal);

  return <>
    <div className="space-y-2">
      <p className="text-sm font-medium text-paper">
        {isVial ? "What strength is printed on the vial?" : "Strength (optional)"}
      </p>
      {isVial && <p className="text-xs leading-relaxed text-faint">Copy either version of the label: 1,000 mg per 5 mL or 200 mg per 1 mL. They mean the same concentration.</p>}
      <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_auto_9rem]">
        <label className={`${label} min-w-0`}>{isVial ? "Amount on the label" : "Amount"}
          <input type="number" name="conc_amount" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${input} tabular`} />
        </label>
        <label className={label}>Unit
          <select name="conc_unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={input}>{DOSE_UNITS.map((u) => <option key={u}>{u}</option>)}</select>
        </label>
        <span className="hidden pb-3 text-sm text-faint sm:block">per</span>
        <label className={`${label} col-span-2 sm:col-span-1`}>{isVial ? "Per how many mL?" : "Volume (mL)"}
          <input type="number" name="conc_per_volume" min="0" step="any" value={perVolume} onChange={(e) => setPerVolume(e.target.value)} className={`${input} tabular`} />
        </label>
      </div>
    </div>

    {useVialVolume ? <div className="space-y-2">
      <label className={label}>How much liquid is in the vial? (optional)
        <div className="flex items-center gap-3">
          <input type="number" name="package_count" min="0" step="any" value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="e.g. 5" className={`${input} tabular`} />
          <span className="text-sm text-muted">mL</span>
        </div>
      </label>
      <input type="hidden" name="package_unit" value="mL" />
      <p className="text-xs text-faint">Enter the total liquid volume, such as 5 mL for a 5 mL vial.</p>
    </div> : <div className="space-y-3">
      <div className="flex gap-3">
        <label className={`${label} min-w-0 flex-1`}>Pack count (optional)
          <input type="number" name="package_count" min="0" step="any" value={packCount} onChange={(e) => setPackCount(e.target.value)} className={`${input} tabular`} />
        </label>
        <label className={`${label} min-w-0 flex-1`}>Pack unit (optional)
          <input type="text" name="package_unit" value={packUnit} onChange={(e) => setPackUnit(e.target.value)} placeholder="e.g. tablets, mL" className={input} />
        </label>
      </div>
      {isVial && <div className="space-y-1">
        <p className="text-xs text-faint">This record has an older package quantity. Enter the liquid volume to record the vial in mL instead.</p>
        <button type="button" onClick={() => { setKeepLegacyQuantity(false); setVolume(""); onQuantityChange(); }} className="min-h-11 text-sm text-paper underline">Enter liquid volume instead</button>
      </div>}
    </div>}

    {isVial && validConcentration && <p aria-live="polite" className="rounded-md border border-line bg-surface p-3 text-sm leading-relaxed text-paper">
      Each 1 mL contains {quantity(perMl)} {unit}.
      {useVialVolume && validVolume ? ` This ${quantity(Number(volume))} mL vial contains ${quantity(vialTotal)} ${unit} in total.` : ""}
    </p>}
  </>;
}
