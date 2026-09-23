"use client";

import { useEffect, useMemo, useState } from "react";
import { DOSE_UNITS, ROUTES, type Frequency } from "@/lib/types";
import { PLAIN_ROUTES, WEEKDAYS, readRegimenInput, regimenInputIssue, readableNumber, type RegimenInput } from "@/lib/regimen-plan";

export type FrequencyInitial = {
  type?: Frequency["type"]; interval?: number; unit?: string; count?: number; period?: string;
  days?: number[]; time?: string | null; time_zone?: string; weekly_total?: number;
};
export type RegimenInitial = { doseAmount?: string; doseUnit?: string; route?: string; freq?: FrequencyInitial };
const input = "mt-1 block min-h-11 w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-paper";
const label = "block text-sm text-muted";
const presets = [
  ["daily", "Every day"], ["once_weekly", "Once a week"], ["weekly", "On days I choose"],
  ["every", "Every few hours, days, or weeks"], ["times_per", "Several times a day or week"], ["as_needed", "As needed"],
];

function initialPreset(f?: FrequencyInitial): string {
  if (f?.type === "every" && f.interval === 1 && f.unit === "day") return "daily";
  if (!f?.type || (f.type === "every" && f.interval === 1 && f.unit === "week")) return "once_weekly";
  return f.type;
}

/** Plain-language editor, shared by prescription and chosen plan. The posted
 * fields use the same defensive parser as the server (PRD §4.1/§5.3). */
export function RegimenFields({ prefix, initial = {}, split = false, onPlanChange, onRouteChange, onIssueChange }: {
  prefix: string; initial?: RegimenInitial; split?: boolean;
  onPlanChange: (plan: RegimenInput | null) => void;
  onRouteChange?: (route: string) => void;
  onIssueChange?: (issue: string | null) => void;
}) {
  const [preset, setPreset] = useState(split ? "weekly" : initialPreset(initial.freq));
  const [amount, setAmount] = useState(initial.doseAmount ?? "");
  const [total, setTotal] = useState(String(initial.freq?.weekly_total ?? ""));
  const [basis, setBasis] = useState(initial.freq?.weekly_total != null || split ? "weekly_total" : "per_dose");
  const [unit, setUnit] = useState(initial.doseUnit ?? "mg");
  const [route, setRoute] = useState(initial.route ?? "oral");
  const [interval, setInterval] = useState(String(initial.freq?.interval ?? 1));
  const [intervalUnit, setIntervalUnit] = useState(initial.freq?.unit ?? "day");
  const [count, setCount] = useState(String(initial.freq?.count ?? 1));
  const [period, setPeriod] = useState(initial.freq?.period ?? "day");
  const [days, setDays] = useState<number[]>(initial.freq?.days ?? []);
  const [noTime, setNoTime] = useState(initial.freq?.time === null);
  const [time, setTime] = useState(initial.freq?.time ?? "");
  const [zone, setZone] = useState(initial.freq?.time_zone ?? "");
  useEffect(() => {
    if (!initial.freq?.time_zone) setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [initial.freq?.time_zone]);

  const namedDays = preset === "weekly";
  const weeklyTotalMode = namedDays && basis === "weekly_total";
  const fields = useMemo(() => {
    const f: Record<string, string | string[]> = {
      [`${prefix}_dose_amount`]: amount, [`${prefix}_dose_unit`]: unit, [`${prefix}_route`]: route,
      [`${prefix}_amount_basis`]: weeklyTotalMode ? "weekly_total" : "per_dose",
      [`${prefix}_weekly_total`]: total,
      [`${prefix}_freq_type`]: preset === "daily" || preset === "once_weekly" ? "every" : preset,
      [`${prefix}_freq_interval`]: preset === "daily" || preset === "once_weekly" ? "1" : interval,
      [`${prefix}_freq_unit`]: preset === "daily" ? "day" : preset === "once_weekly" ? "week" : intervalUnit,
      [`${prefix}_freq_count`]: count, [`${prefix}_freq_period`]: period,
      [`${prefix}_freq_time_unspecified`]: noTime ? "on" : "",
      [`${prefix}_freq_days`]: days.map(String), [`${prefix}_freq_time`]: time, [`${prefix}_freq_time_zone`]: zone,
    };
    return f;
  }, [prefix, amount, unit, route, weeklyTotalMode, total, preset, interval, intervalUnit, count, period, days, time, zone, noTime]);
  const formData = useMemo(() => {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) for (const v of Array.isArray(value) ? value : [value]) fd.append(key, v);
    return fd;
  }, [fields, prefix]);
  const plan = useMemo(() => readRegimenInput(formData, prefix), [formData, prefix]);
  const issue = regimenInputIssue(formData, prefix);
  useEffect(() => onRouteChange?.(route), [onRouteChange, route]);
  useEffect(() => onIssueChange?.(issue), [onIssueChange, issue]);
  useEffect(() => onPlanChange(plan), [onPlanChange, plan]);

  function changeBasis(next: string) {
    // Changing the way an amount is entered must not multiply the weekly total.
    if (days.length && next !== basis) {
      if (next === "weekly_total" && Number(amount) > 0) setTotal(String(Number(amount) * days.length));
      if (next === "per_dose" && Number(total) > 0) setAmount(String(Number(total) / days.length));
    }
    setBasis(next);
  }

  return <div className="space-y-4">
    {Object.entries(fields).flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map((v, i) => <input key={`${name}-${i}`} type="hidden" name={name} value={v} />))}
    {!split && <label className={label}>How often?
      <select className={input} value={preset} onChange={(e) => setPreset(e.target.value)}>{presets.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
    </label>}
    {namedDays && <label className={label}>I'm entering
      <select className={input} value={basis} onChange={(e) => changeBasis(e.target.value)}><option value="weekly_total">The total for the week</option><option value="per_dose">The amount each time</option></select>
    </label>}
    <div className="flex gap-3">
      <label className={`${label} min-w-0 flex-1`}>{weeklyTotalMode ? "Total for the week" : "Amount each time"}
        <input type="number" min="0" step="any" required className={`${input} tabular`} value={weeklyTotalMode ? total : amount} onChange={(e) => weeklyTotalMode ? setTotal(e.target.value) : setAmount(e.target.value)} />
      </label>
      <label className={`${label} w-28`}>Measured in
        <select className={input} value={unit} onChange={(e) => setUnit(e.target.value)}>{DOSE_UNITS.map((u) => <option key={u}>{u}</option>)}</select>
      </label>
    </div>
    <label className={label}>How is it taken?
      <select className={input} value={route} onChange={(e) => setRoute(e.target.value)}>{ROUTES.map((r) => <option key={r} value={r}>{PLAIN_ROUTES[r][0].toUpperCase() + PLAIN_ROUTES[r].slice(1)}{r === "intramuscular" ? " (intramuscular)" : r === "subcutaneous" ? " (subcutaneous)" : ""}</option>)}</select>
    </label>
    {preset === "every" && <div className="flex gap-3"><label className={`${label} flex-1`}>Every how many?<input className={input} type="number" min="1" step="any" value={interval} onChange={(e) => setInterval(e.target.value)} required /></label><label className={`${label} flex-1`}>Hours, days, weeks, or months<select className={input} value={intervalUnit} onChange={(e) => setIntervalUnit(e.target.value)}>{["hour", "day", "week", "month"].map((u) => <option key={u} value={u}>{u}s</option>)}</select></label></div>}
    {preset === "times_per" && <div className="space-y-2"><div className="flex gap-3"><label className={`${label} flex-1`}>How many times?<input className={input} type="number" min="1" step="1" value={count} onChange={(e) => setCount(e.target.value)} required /></label><label className={`${label} flex-1`}>During each<select className={input} value={period} onChange={(e) => setPeriod(e.target.value)}><option value="day">Day</option><option value="week">Week</option></select></label></div><p className="text-xs text-faint">This uses evenly spaced intervals. For specific weekdays, choose “On days I choose.”</p></div>}
    {namedDays && <fieldset className="space-y-3">
      <legend className="text-sm text-muted">Which days each week?</legend>
      <div className="flex flex-wrap gap-2">{WEEKDAYS.map((day, i) => <button key={day} type="button" aria-label={day} aria-pressed={days.includes(i + 1)} onClick={() => setDays((current) => current.includes(i + 1) ? current.filter((d) => d !== i + 1) : [...current, i + 1].sort((a, b) => a - b))} className={`min-h-11 min-w-11 rounded-md border px-3 text-sm ${days.includes(i + 1) ? "border-accent bg-accent-surface text-accent" : "border-line bg-surface text-paper"}`}>{day.slice(0, 3)}</button>)}</div>
      <button type="button" onClick={() => setDays([1, 2, 3, 4, 5, 6, 7])} className="min-h-11 text-sm text-paper underline">Every day</button>
      <p className="text-sm text-muted">{days.length ? `${days.length} ${days.length === 1 ? "dose" : "doses"} per week · one on each selected day` : "Choose at least one day."}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted">Time on these days</span>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-paper">
          <input type="checkbox" checked={noTime} onChange={(e) => { setNoTime(e.target.checked); if (e.target.checked) setZone(Intl.DateTimeFormat().resolvedOptions().timeZone); }} className="accent-accent" />
          N/A — no set time
        </label>
      </div>
      {!noTime && <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Time<input type="time" className={input} required defaultValue={time} onChange={(e) => setTime(e.target.value)} /></label>
        <label className={label}>Time zone<input className={input} list={`${prefix}-zones`} required value={zone} onChange={(e) => setZone(e.target.value)} /><datalist id={`${prefix}-zones`}>{Array.from(new Set([zone, "America/Toronto", "America/Vancouver", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Australia/Sydney", "UTC"])).map((z) => <option key={z} value={z} />)}</datalist></label>
      </div>}
      <p className="text-xs text-faint">{noTime ? "Your selected days stay on the calendar. No timed reminders are scheduled for this plan." : "Times follow this time zone, including daylight saving. A time skipped by a clock change moves forward with the clock; a repeated time appears once."}</p>
      {issue && <p className="text-sm text-muted">{issue}</p>}
      {plan && <p className="text-sm text-paper">{weeklyTotalMode ? `${readableNumber(Number(total))} ${unit} ÷ ${days.length} = ${readableNumber(plan.dose_amount)} ${unit} each time.` : `${readableNumber(plan.dose_amount)} ${unit} × ${days.length} = ${readableNumber(plan.dose_amount * days.length)} ${unit} per week.`}{weeklyTotalMode && Number(total) / days.length !== Number((Number(total) / days.length).toFixed(Number(total) / days.length < 0.01 ? 6 : 2)) ? " Display rounded; the entered weekly total is kept." : ""}</p>}
    </fieldset>}
  </div>;
}
