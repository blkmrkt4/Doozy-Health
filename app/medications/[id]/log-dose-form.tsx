"use client";

import { useState } from "react";
import { logDose } from "@/app/medications/actions";
import { DOSE_UNITS, ROUTES, ROUTE_LABELS } from "@/lib/types";

const inputCls =
  "mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-paper outline-none focus:border-accent";
const labelCls = "block text-sm text-muted";

type EventType = "taken" | "prn" | "skipped";

// "Log differently" — the expanded path from §4.3: a different amount/time, an
// as-needed (PRN) dose, or a skip with a reason. The one-tap "Taken now" path
// is a separate server-action form on the detail page.
export function LogDoseForm({
  medicationId,
  defaultAmount,
  defaultUnit,
  defaultRoute,
  isInjectable,
  isPatch = false,
}: {
  medicationId: string;
  defaultAmount: string;
  defaultUnit: string;
  defaultRoute: string;
  isInjectable: boolean;
  isPatch?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [eventType, setEventType] = useState<EventType>("taken");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-surface"
      >
        Log differently
      </button>
    );
  }

  const isDose = eventType !== "skipped";

  return (
    <form action={logDose} className="space-y-4 rounded-md border border-line p-4">
      <input type="hidden" name="medication_id" value={medicationId} />

      <label className={labelCls}>
        What to log
        <select
          name="event_type"
          value={eventType}
          onChange={(e) => setEventType(e.target.value as EventType)}
          className={inputCls}
        >
          <option value="taken">A dose (different amount or time)</option>
          <option value="prn">An as-needed (PRN) dose</option>
          <option value="skipped">A skipped dose</option>
        </select>
      </label>

      {isDose ? (
        <>
          <div className="flex gap-3">
            <label className={`${labelCls} flex-1`}>
              Amount
              <input
                type="number"
                name="amount"
                min={0}
                step="any"
                defaultValue={defaultAmount}
                required
                className={`${inputCls} tabular`}
              />
            </label>
            <label className={`${labelCls} w-28`}>
              Unit
              <select name="unit" defaultValue={defaultUnit} className={inputCls}>
                {DOSE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={labelCls}>
            Route
            <select name="route_taken" defaultValue={defaultRoute} className={inputCls}>
              {ROUTES.map((r) => (
                <option key={r} value={r}>
                  {ROUTE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          {isInjectable ? (
            <label className={labelCls}>
              Injection site (optional)
              <input
                type="text"
                name="site"
                placeholder="e.g. left thigh"
                className={inputCls}
              />
            </label>
          ) : null}
          {isPatch ? (
            <>
              <label className={labelCls}>
                Placement (optional)
                <input
                  type="text"
                  name="site"
                  placeholder="e.g. lower abdomen, left"
                  className={inputCls}
                />
              </label>
              <label className={labelCls}>
                Expected removal
                <input
                  type="datetime-local"
                  name="expected_removal"
                  className={inputCls}
                />
              </label>
            </>
          ) : null}
        </>
      ) : (
        <label className={labelCls}>
          Reason (optional)
          <input
            type="text"
            name="skip_reason"
            placeholder="e.g. felt unwell"
            className={inputCls}
          />
        </label>
      )}

      <label className={labelCls}>
        When (optional — defaults to now)
        <input type="datetime-local" name="logged_at" className={inputCls} />
      </label>

      {isDose ? (
        <label className={labelCls}>
          Note (optional)
          <input type="text" name="note" className={inputCls} />
        </label>
      ) : null}

      <div className="flex gap-3">
        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90"
        >
          Log
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-surface"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
