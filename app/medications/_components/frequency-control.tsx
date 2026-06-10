"use client";

import { useState } from "react";
import {
  FREQUENCY_PERIODS,
  FREQUENCY_UNITS,
  type Frequency,
} from "@/lib/types";

// A self-contained structured cadence picker for the extraction review screen:
// "How often" + the matching interval/count fields, posting `${prefix}_type`,
// `${prefix}_interval`, `${prefix}_unit`, `${prefix}_count`, `${prefix}_period`
// so the server's parseFrequency(prefix) reads a real schedule (not a sentence).
// Seeded from `init` — the cadence parsed off the label — so the user only
// confirms rather than re-enters.

type FreqType = Frequency["type"];

const inputCls =
  "mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-paper outline-none focus:border-accent";
const labelCls = "block text-sm text-muted";

export function FrequencyControl({
  prefix,
  init,
}: {
  prefix: string;
  /** Parsed cadence to seed the picker; null leaves it on the daily default. */
  init?: Frequency | null;
}) {
  const [type, setType] = useState<FreqType>(init?.type ?? "every");

  const everyInit = init?.type === "every" ? init : null;
  const timesInit = init?.type === "times_per" ? init : null;

  return (
    <div className="space-y-3">
      <label className={labelCls}>
        How often
        <select
          name={`${prefix}_type`}
          value={type}
          onChange={(e) => setType(e.target.value as FreqType)}
          className={inputCls}
        >
          <option value="every">Every…</option>
          <option value="times_per">A number of times per…</option>
          <option value="as_needed">As needed (PRN)</option>
        </select>
      </label>

      {type === "every" ? (
        <div className="flex gap-3">
          <label className={`${labelCls} flex-1`}>
            Interval
            <input
              type="number"
              name={`${prefix}_interval`}
              min={1}
              step={1}
              defaultValue={everyInit?.interval ?? 1}
              className={`${inputCls} tabular`}
            />
          </label>
          <label className={`${labelCls} flex-1`}>
            Unit
            <select
              name={`${prefix}_unit`}
              defaultValue={everyInit?.unit ?? "day"}
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

      {type === "times_per" ? (
        <div className="flex gap-3">
          <label className={`${labelCls} flex-1`}>
            Times
            <input
              type="number"
              name={`${prefix}_count`}
              min={1}
              step={1}
              defaultValue={timesInit?.count ?? 1}
              className={`${inputCls} tabular`}
            />
          </label>
          <label className={`${labelCls} flex-1`}>
            Per
            <select
              name={`${prefix}_period`}
              defaultValue={timesInit?.period ?? "day"}
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
