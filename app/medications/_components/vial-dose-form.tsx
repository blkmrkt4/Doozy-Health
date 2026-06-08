"use client";

import { useState } from "react";
import {
  DOSE_UNITS,
  DILUENTS,
  FORM_TYPES,
  FORM_TYPE_LABELS,
  FREQUENCY_UNITS,
  FREQUENCY_PERIODS,
  isInjectableForm,
  guessFormType,
  type FormType,
  type LlmConfidence,
} from "@/lib/types";
import { doseToVolumeMl, formatVolumeMl, convertDose } from "@/lib/units";
import { ConfidenceBadge, confidenceStyle } from "./extraction-field";

const INPUT_CLASS =
  "mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-paper outline-none focus:border-accent";

type FreqType = "every" | "times_per" | "as_needed";

type Schedule = {
  type: FreqType;
  count: string;
  period: string;
  interval: string;
  unit: string;
  durationDays: string;
};

/** Plain-language schedule summary, e.g. "3× daily for 10 days". Null if the
 *  schedule isn't meaningfully set. */
function scheduleSummary(s: Schedule): string | null {
  let cadence: string | null = null;
  if (s.type === "times_per") {
    const c = Number(s.count);
    if (c > 0) cadence = `${c}× ${s.period === "day" ? "daily" : "weekly"}`;
  } else if (s.type === "every") {
    const i = Number(s.interval);
    if (i > 0) cadence = i === 1 ? `every ${s.unit}` : `every ${i} ${s.unit}s`;
  } else if (s.type === "as_needed") {
    cadence = "as needed";
  }
  if (!cadence) return null;
  const d = Number(s.durationDays);
  return d > 0 ? `${cadence} for ${d} days` : cadence;
}

type Concentration = {
  amount: number | null;
  unit: string;
  perVolume: number | null;
  volumeMl: number | null;
  amountConfidence: LlmConfidence;
  unitConfidence: LlmConfidence;
  perVolumeConfidence: LlmConfidence;
  volumeConfidence: LlmConfidence;
  // Reconstitution (powder + diluent): when true the concentration fields are
  // relabelled — amount = active in the vial, per-volume = the diluent volume
  // the prescription says to add.
  requiresReconstitution?: boolean;
  diluentType?: string;
};

/**
 * Form-aware dosing section for a scanned vial/package. The delivery form drives
 * everything: an injectable shows concentration + a live syringe volume; a solid
 * oral form (tablet/capsule) shows "take N tablets", each carrying the per-unit
 * strength — so a pill never gets the injectable treatment (PRD §5.2, §5.11).
 */
export function VialDoseForm({
  strength,
  route,
  defaultDoseUnit,
  concentration,
}: {
  strength: string;
  route: string;
  defaultDoseUnit: string;
  concentration: Concentration;
}) {
  const [formType, setFormType] = useState<FormType>(() =>
    guessFormType({
      route,
      concentrationAmount: concentration.amount,
      concentrationPerVolume: concentration.perVolume,
    })
  );

  const [schedule, setSchedule] = useState<Schedule>({
    type: "times_per",
    count: "1",
    period: "day",
    interval: "1",
    unit: "week",
    durationDays: "",
  });
  const summary = scheduleSummary(schedule);
  const setS = (patch: Partial<Schedule>) =>
    setSchedule((s) => ({ ...s, ...patch }));

  return (
    <>
      <fieldset className="space-y-2 rounded-md border border-line p-4">
        <legend className="text-sm font-medium text-paper">Delivery form</legend>
        <p className="text-xs text-faint">
          How the medicine is taken. This decides whether we ask about
          concentration &amp; syringe volume (injectables) or tablets.
        </p>
        <select
          name="form_type"
          value={formType}
          onChange={(e) => setFormType(e.target.value as FormType)}
          className={INPUT_CLASS}
        >
          {FORM_TYPES.map((f) => (
            <option key={f} value={f}>
              {FORM_TYPE_LABELS[f]}
            </option>
          ))}
        </select>
      </fieldset>

      <ScheduleFields schedule={schedule} setS={setS} />

      {isInjectableForm(formType) ? (
        <InjectableFields
          concentration={concentration}
          defaultDoseUnit={defaultDoseUnit}
          scheduleSummary={summary}
        />
      ) : (
        <SolidFields
          strength={strength}
          unit={formType === "capsule" ? "capsule" : "tablet"}
          scheduleSummary={summary}
        />
      )}
    </>
  );
}

// ── Schedule (how often + duration) — shared by both modes ──────────────────

function ScheduleFields({
  schedule,
  setS,
}: {
  schedule: Schedule;
  setS: (patch: Partial<Schedule>) => void;
}) {
  return (
    <fieldset className="space-y-4 rounded-md border border-line p-4">
      <legend className="text-sm font-medium text-paper">How often</legend>
      <p className="text-xs text-faint">
        The schedule from the label, e.g. &ldquo;three times daily for 10
        days&rdquo;. Stored so reminders and the timeline know the cadence.
      </p>

      <div>
        <label htmlFor="freq_type" className="block text-sm text-muted">
          Frequency
        </label>
        <select
          id="freq_type"
          name="freq_type"
          value={schedule.type}
          onChange={(e) => setS({ type: e.target.value as FreqType })}
          className={INPUT_CLASS}
        >
          <option value="times_per">A number of times per…</option>
          <option value="every">Every…</option>
          <option value="as_needed">As needed (PRN)</option>
        </select>
      </div>

      {schedule.type === "times_per" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="freq_count" className="block text-sm text-muted">
              Times
            </label>
            <input
              id="freq_count"
              name="freq_count"
              type="number"
              min="1"
              step="1"
              value={schedule.count}
              onChange={(e) => setS({ count: e.target.value })}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="freq_period" className="block text-sm text-muted">
              Per
            </label>
            <select
              id="freq_period"
              name="freq_period"
              value={schedule.period}
              onChange={(e) => setS({ period: e.target.value })}
              className={INPUT_CLASS}
            >
              {FREQUENCY_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {schedule.type === "every" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="freq_interval" className="block text-sm text-muted">
              Interval
            </label>
            <input
              id="freq_interval"
              name="freq_interval"
              type="number"
              min="1"
              step="1"
              value={schedule.interval}
              onChange={(e) => setS({ interval: e.target.value })}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="freq_unit" className="block text-sm text-muted">
              Unit
            </label>
            <select
              id="freq_unit"
              name="freq_unit"
              value={schedule.unit}
              onChange={(e) => setS({ unit: e.target.value })}
              className={INPUT_CLASS}
            >
              {FREQUENCY_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <div>
        <label htmlFor="duration_days" className="block text-sm text-muted">
          Duration (days, optional)
        </label>
        <input
          id="duration_days"
          name="duration_days"
          type="number"
          min="1"
          step="1"
          value={schedule.durationDays}
          onChange={(e) => setS({ durationDays: e.target.value })}
          placeholder="e.g. 10"
          className={INPUT_CLASS}
        />
      </div>
    </fieldset>
  );
}

// ── Injectable (vial) ───────────────────────────────────────────────────────

function InjectableFields({
  concentration,
  defaultDoseUnit,
  scheduleSummary,
}: {
  concentration: Concentration;
  defaultDoseUnit: string;
  scheduleSummary: string | null;
}) {
  const [isRecon, setIsRecon] = useState(
    concentration.requiresReconstitution ?? false
  );
  const [diluent, setDiluent] = useState(
    concentration.diluentType || "bacteriostatic water"
  );
  const [cAmount, setCAmount] = useState(
    concentration.amount ? String(concentration.amount) : ""
  );
  const [cUnit, setCUnit] = useState(
    concentration.unit || (concentration.requiresReconstitution ? "IU" : "mg")
  );
  // 0 (e.g. a powder's unknown per-volume before mixing) starts empty so the
  // user fills in the mix volume from their prescription.
  const [cPer, setCPer] = useState(
    concentration.perVolume ? String(concentration.perVolume) : ""
  );
  const [dose, setDose] = useState("");
  const [doseUnit, setDoseUnit] = useState(
    defaultDoseUnit && defaultDoseUnit !== "tablet" && defaultDoseUnit !== "capsule"
      ? defaultDoseUnit
      : "mg"
  );

  const cAmountN = Number(cAmount);
  const cPerN = Number(cPer);
  const doseN = Number(dose);
  const concKnown = cAmountN > 0 && cPerN > 0;

  let volumeHint: string | null = null;
  let unitMismatch = false;
  if (doseN > 0 && concKnown) {
    const doseInConcUnit =
      doseUnit === cUnit ? doseN : convertDose(doseN, doseUnit, cUnit);
    if (doseInConcUnit && doseInConcUnit > 0) {
      const mL = doseToVolumeMl(doseInConcUnit, cAmountN, cPerN);
      if (mL > 0 && Number.isFinite(mL)) {
        volumeHint = `At ${cAmountN} ${cUnit}/${cPerN} mL, a ${doseN} ${doseUnit} dose works out to ${formatVolumeMl(mL)}${scheduleSummary ? ` (${scheduleSummary})` : ""}.`;
      }
    } else {
      unitMismatch = true;
    }
  }

  return (
    <>
      <fieldset className="space-y-4 rounded-md border border-line p-4">
        <legend className="text-sm font-medium text-paper">Concentration</legend>

        {/* Reconstitution: a powder's strength depends on how much liquid you
            add, so we relabel the fields and compute the result. */}
        <label className="flex items-start gap-2 text-sm text-muted">
          <input
            type="checkbox"
            name="is_reconstituted"
            checked={isRecon}
            onChange={(e) => setIsRecon(e.target.checked)}
            className="mt-0.5"
          />
          <span>This vial is a powder I mix before use (e.g. hCG, a peptide)</span>
        </label>

        {isRecon ? (
          <p className="text-xs text-faint">
            A powder&rsquo;s strength depends on how much liquid you add. Enter the
            active amount printed on the vial and the volume your{" "}
            <span className="text-muted">prescription</span> tells you to add — we
            work out the concentration. The volume comes from your prescription, not
            from us.
          </p>
        ) : (
          <p className="text-xs text-faint">
            How strong the liquid is — e.g. 200 mg in every 1 mL. This is the
            vial&rsquo;s label, not your dose. We use it to work out the syringe
            volume below.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Labeled
            label={isRecon ? "Active in the vial" : "Concentration"}
            confidence={concentration.amountConfidence}
          >
            <input
              name="concentration_amount"
              type="number"
              step="any"
              value={cAmount}
              onChange={(e) => setCAmount(e.target.value)}
              className={INPUT_CLASS}
            />
          </Labeled>
          <Labeled label={isRecon ? "Active unit" : "Conc. unit"} confidence={concentration.unitConfidence}>
            <select
              name="concentration_unit"
              value={cUnit}
              onChange={(e) => setCUnit(e.target.value)}
              className={INPUT_CLASS}
            >
              {DOSE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled
            label={isRecon ? "Water to add (mL)" : "Per volume (mL)"}
            confidence={concentration.perVolumeConfidence}
          >
            <input
              name="concentration_per_volume"
              type="number"
              step="any"
              value={cPer}
              onChange={(e) => setCPer(e.target.value)}
              placeholder={isRecon ? "from your prescription" : undefined}
              className={INPUT_CLASS}
            />
          </Labeled>
        </div>

        {isRecon ? (
          <>
            <div>
              <label htmlFor="diluent_type" className="block text-sm text-muted">
                Diluent (what you mix with)
              </label>
              <select
                id="diluent_type"
                name="diluent_type"
                value={diluent}
                onChange={(e) => setDiluent(e.target.value)}
                className={INPUT_CLASS}
              >
                {DILUENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            {concKnown ? (
              <p className="rounded-md border border-accent/40 bg-surface p-3 text-sm text-paper">
                <span className="font-medium text-accent">After mixing</span> —{" "}
                {cAmountN} {cUnit} in {cPerN} mL {diluent} works out to{" "}
                {Number((cAmountN / cPerN).toFixed(2))} {cUnit}/mL. A units
                conversion to help you measure; always follow your prescription.
              </p>
            ) : null}
          </>
        ) : (
          <Labeled
            label="Total volume in vial (mL)"
            confidence={concentration.volumeConfidence}
          >
            <input
              name="volume_ml"
              type="number"
              step="any"
              defaultValue={
                concentration.volumeMl != null ? String(concentration.volumeMl) : ""
              }
              className={INPUT_CLASS}
            />
          </Labeled>
        )}
      </fieldset>

      <fieldset className="space-y-4 rounded-md border border-line p-4">
        <legend className="text-sm font-medium text-paper">
          Your dose (each time)
        </legend>
        <p className="text-xs text-faint">
          What your prescription says to take each time — not the total printed on
          the vial.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="dose_amount" className="block text-sm text-muted">
              Dose amount
            </label>
            <input
              id="dose_amount"
              name="dose_amount"
              type="number"
              step="any"
              required
              value={dose}
              onChange={(e) => setDose(e.target.value)}
              placeholder="from your prescription"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="dose_unit" className="block text-sm text-muted">
              Dose unit
            </label>
            <select
              id="dose_unit"
              name="dose_unit"
              value={doseUnit}
              onChange={(e) => setDoseUnit(e.target.value)}
              className={INPUT_CLASS}
            >
              {DOSE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>
        {volumeHint ? (
          <p className="rounded-md border border-accent/40 bg-surface p-3 text-sm text-paper">
            <span className="font-medium text-accent">Syringe volume</span> —{" "}
            {volumeHint} A units conversion to help you measure; always follow your
            prescription.
          </p>
        ) : null}
        {unitMismatch ? (
          <p className="text-xs text-faint">
            Enter the dose in a unit comparable to the concentration ({cUnit}) to
            see the syringe volume.
          </p>
        ) : null}
      </fieldset>
    </>
  );
}

// ── Solid oral (tablet / capsule) ───────────────────────────────────────────

/** Split an extracted strength like "10 mg" into a numeric amount + unit. */
function parseStrength(s: string): { amount: string; unit: string } {
  const m = s.trim().match(/([\d.]+)\s*([a-zA-Zµ]+)?/);
  if (!m) return { amount: "", unit: "mg" };
  const unit = (m[2] || "mg").toLowerCase();
  const valid = (DOSE_UNITS as readonly string[]).includes(unit) ? unit : "mg";
  return { amount: m[1] ?? "", unit: valid };
}

function SolidFields({
  strength,
  unit,
  scheduleSummary,
}: {
  strength: string;
  unit: "tablet" | "capsule";
  scheduleSummary: string | null;
}) {
  const parsed = parseStrength(strength);
  const [count, setCount] = useState("1");
  const [strengthAmount, setStrengthAmount] = useState(parsed.amount);
  const [strengthUnit, setStrengthUnit] = useState(parsed.unit);

  const countN = Number(count);
  const strAmtN = Number(strengthAmount);
  const plural = countN === 1 ? unit : `${unit}s`;
  // Total active amount = how many × per-unit strength (e.g. 2 × 10 mg = 20 mg).
  const total =
    countN > 0 && strAmtN > 0
      ? `${Number((countN * strAmtN).toFixed(4))} ${strengthUnit}`
      : null;

  return (
    <fieldset className="space-y-4 rounded-md border border-line p-4">
      <legend className="text-sm font-medium text-paper">
        Strength &amp; dose
      </legend>
      <p className="text-xs text-faint">
        The strength is per {unit}; your dose is how many you take. We store both,
        so &ldquo;1 {unit}&rdquo; always knows its {strengthUnit}. The label&rsquo;s
        own wording is kept verbatim in Directions above.
      </p>

      {/* The dose unit follows the delivery form chosen above (tablet/capsule). */}
      <input type="hidden" name="dose_unit" value={unit} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="strength_amount" className="block text-sm text-muted">
            Strength per {unit}
          </label>
          <input
            id="strength_amount"
            name="strength_amount"
            type="number"
            step="any"
            min="0"
            value={strengthAmount}
            onChange={(e) => setStrengthAmount(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor="strength_unit" className="block text-sm text-muted">
            Strength unit
          </label>
          <select
            id="strength_unit"
            name="strength_unit"
            value={strengthUnit}
            onChange={(e) => setStrengthUnit(e.target.value)}
            className={INPUT_CLASS}
          >
            {DOSE_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="dose_amount" className="block text-sm text-muted">
          How many {unit}s each time
        </label>
        <input
          id="dose_amount"
          name="dose_amount"
          type="number"
          step="any"
          min="0"
          required
          value={count}
          onChange={(e) => setCount(e.target.value)}
          className={INPUT_CLASS}
        />
      </div>

      {countN > 0 ? (
        <p className="rounded-md border border-accent/40 bg-surface p-3 text-sm text-paper">
          <span className="font-medium text-accent">Each dose</span> — {countN}{" "}
          {plural}
          {strAmtN > 0 && total ? ` × ${strengthAmount} ${strengthUnit} = ${total}` : ""}
          {scheduleSummary ? ` (${scheduleSummary})` : ""}. This is our
          calculation from the fields above — not the label&rsquo;s wording.
        </p>
      ) : null}
    </fieldset>
  );
}

// ── Small labelled wrapper with a confidence badge ──────────────────────────

function Labeled({
  label,
  confidence,
  children,
}: {
  label: string;
  confidence: LlmConfidence;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="block text-sm text-muted">{label}</span>
        <ConfidenceBadge style={confidenceStyle(confidence)} />
      </div>
      {children}
    </div>
  );
}
