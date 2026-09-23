"use client";

import { useId, useState } from "react";
import { formatNeedleLength, lengthEntry, readSyringeMeasurements, type LengthUnit } from "@/lib/syringe-measurements";

type SyringeInitial = { capacity?: string; gauge?: string; lengthIn?: string; markings?: string };
const input = "mt-1 block min-h-11 w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-paper";
const label = "block text-sm text-muted";
const known = (value?: string) => value && Number(value) !== 0 ? value : "";

/** The package can mix mL, G, and fractional inches or millimeters. Each
 * measurement has its own unit; the server repeats the same validation. */
export function SyringeFields({ prefix = "", initial = {}, requireCapacityForDetails = false }: {
  prefix?: string;
  initial?: SyringeInitial;
  requireCapacityForDetails?: boolean;
}) {
  const id = useId();
  const [capacity, setCapacity] = useState(known(initial.capacity));
  const [gauge, setGauge] = useState(known(initial.gauge));
  const [length, setLength] = useState(known(initial.lengthIn));
  const [unit, setUnit] = useState<LengthUnit>("in");
  const [markings, setMarkings] = useState(initial.markings ?? "");
  const data = new FormData();
  for (const [name, value] of Object.entries({ capacity_ml: capacity, needle_gauge: gauge, needle_length: length, needle_length_unit: unit, unit_markings: markings })) data.set(`${prefix}${name}`, value);
  const { spec, errors } = readSyringeMeasurements(data, prefix, requireCapacityForDetails);
  const summary = [
    spec.capacity_mL ? `${spec.capacity_mL} mL syringe` : "",
    spec.needle_gauge ? `${spec.needle_gauge}G needle` : "",
    spec.needle_length_in ? `Length: ${formatNeedleLength(spec.needle_length_in)}` : "",
  ].filter(Boolean).join(" · ");

  return <div className="space-y-4">
    <p className="text-xs leading-relaxed text-faint">Copy the measurements from the package. Needle length accepts fractions, decimals, inches, or millimeters.</p>
    <div className="grid grid-cols-2 gap-3">
      <label className={`${label} min-w-0`}>Capacity (mL)
        <input type="text" name={`${prefix}capacity_ml`} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="e.g. 1 mL" className={`${input} tabular`} aria-invalid={!!errors.capacity} aria-describedby={errors.capacity ? `${id}-capacity-error` : undefined} ref={(el) => { el?.setCustomValidity(errors.capacity ?? ""); }} />
      </label>
      <label className={`${label} min-w-0`}>Needle gauge (G)
        <input type="text" name={`${prefix}needle_gauge`} value={gauge} onChange={(e) => setGauge(e.target.value)} placeholder="e.g. 25G" className={`${input} tabular`} aria-invalid={!!errors.gauge} aria-describedby={errors.gauge ? `${id}-gauge-error` : undefined} ref={(el) => { el?.setCustomValidity(errors.gauge ?? ""); }} />
      </label>
    </div>
    {errors.capacity && <p id={`${id}-capacity-error`} className="text-sm text-muted">{errors.capacity}</p>}
    {errors.gauge && <p id={`${id}-gauge-error`} className="text-sm text-muted">{errors.gauge}</p>}
    <div className="grid grid-cols-2 gap-3">
      <label className={`${label} min-w-0`}>Needle length
        <input type="text" name={`${prefix}needle_length`} value={length} onChange={(e) => {
          const entry = lengthEntry(e.target.value);
          setLength(entry.unit ? entry.amount : e.target.value);
          if (entry.unit) setUnit(entry.unit);
        }} placeholder={unit === "in" ? "e.g. 5/8 or 0.625" : "e.g. 16"} className={`${input} tabular`} aria-invalid={!!errors.length} aria-describedby={`${id}-length-help${errors.length ? ` ${id}-length-error` : ""}`} ref={(el) => { el?.setCustomValidity(errors.length ?? ""); }} />
      </label>
      <label className={`${label} min-w-0`}>Length unit
        <select name={`${prefix}needle_length_unit`} value={unit} onChange={(e) => setUnit(e.target.value as LengthUnit)} className={input}><option value="in">Inches (in)</option><option value="mm">Millimeters (mm)</option></select>
      </label>
    </div>
    <p id={`${id}-length-help`} className="text-xs text-faint">For a 5/8-inch needle, enter 5/8 and choose inches. If the package lists millimeters, enter that number and choose mm.</p>
    {errors.length && <p id={`${id}-length-error`} className="text-sm text-muted">{errors.length}</p>}
    <label className={label}>Unit markings (optional)
      <input type="text" name={`${prefix}unit_markings`} value={markings} onChange={(e) => setMarkings(e.target.value)} placeholder="e.g. 0.1 mL increments" className={input} />
    </label>
    {summary && !Object.keys(errors).length && <p aria-live="polite" className="rounded-md border border-line bg-surface p-3 text-sm leading-relaxed text-paper">{summary}.</p>}
  </div>;
}
