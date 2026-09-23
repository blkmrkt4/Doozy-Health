"use client";

import { useId, useState } from "react";
import { formatNeedleLength, lengthEntry, syringeMarkSpacing, parseSyringeCapacity, readSyringeMeasurements, type LengthUnit } from "@/lib/syringe-measurements";

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
  const initialSpacing = syringeMarkSpacing(initial.markings, parseSyringeCapacity(initial.capacity ?? "") ?? 0);
  const [markingsMode, setMarkingsMode] = useState(initialSpacing ? "spacing" : initial.markings ? "legacy" : "unknown");
  const [spacingText, setSpacingText] = useState(initialSpacing ? String(initialSpacing) : "");
  const [spaceCount, setSpaceCount] = useState("");
  const data = new FormData();
  for (const [name, value] of Object.entries({ capacity_ml: capacity, needle_gauge: gauge, needle_length: length, needle_length_unit: unit, unit_markings: markings, markings_mode: markingsMode, markings_value: markingsMode === "count" ? spaceCount : spacingText })) data.set(`${prefix}${name}`, value);
  const { spec, errors } = readSyringeMeasurements(data, prefix, requireCapacityForDetails);
  const spacing = syringeMarkSpacing(spec.unit_markings, spec.capacity_mL ?? 0);
  const summary = [
    spec.capacity_mL ? `${spec.capacity_mL} mL syringe` : "",
    spec.needle_gauge ? `${spec.needle_gauge}G needle` : "",
    spec.needle_length_in ? `Length: ${formatNeedleLength(spec.needle_length_in)}` : "",
    spacing ? `${Number(spacing.toPrecision(6))} mL between lines` : "",
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
    <label className={label}>Syringe markings
      <select name={`${prefix}markings_mode`} value={markingsMode} onChange={(e) => setMarkingsMode(e.target.value)} className={input}>
        <option value="unknown">I’m not sure yet</option>
        <option value="spacing">I know the mL between lines</option>
        <option value="count">I can count the equal spaces</option>
        {initial.markings && <option value="legacy">Keep the previously entered markings</option>}
      </select>
    </label>
    {markingsMode === "legacy" && <label className={label}>Previously entered markings
      <input type="text" name={`${prefix}unit_markings`} value={markings} onChange={(e) => setMarkings(e.target.value)} className={input} />
    </label>}
    {(markingsMode === "count" || markingsMode === "spacing") && <label className={label}>
      {markingsMode === "count" ? "Equal spaces from zero to full capacity" : "mL between neighboring lines"}
      <input type="text" name={`${prefix}markings_value`} value={markingsMode === "count" ? spaceCount : spacingText} onChange={(e) => markingsMode === "count" ? setSpaceCount(e.target.value) : setSpacingText(e.target.value)} placeholder={markingsMode === "count" ? "e.g. 10" : "e.g. 0.1"} required className={input} aria-invalid={!!errors.markings} aria-describedby={`${id}-markings-help`} ref={(el) => { el?.setCustomValidity(errors.markings ?? ""); }} />
    </label>}
    <p id={`${id}-markings-help`} className="text-xs text-faint">{markingsMode === "unknown"
      ? "You can save without this. The syringe picture will not show a calibrated scale until its markings are known."
      : "Count every equal gap between neighboring lines, including the smaller ones—not just numbered labels. A 1 mL syringe with 10 equal spaces has 0.1 mL between lines."}</p>
    {errors.markings && <p className="text-sm text-muted">{errors.markings}</p>}
    {summary && !Object.keys(errors).length && <p aria-live="polite" className="rounded-md border border-line bg-surface p-3 text-sm leading-relaxed text-paper">{summary}.</p>}
  </div>;
}
