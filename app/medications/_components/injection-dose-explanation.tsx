import { injectionDoseDetails, explainedQuantity } from "@/lib/injection-dose";
import type { MedLogMeta } from "@/lib/adherence";
import type { Frequency } from "@/lib/types";
import { SyringeVisual } from "@/app/medications/_components/syringe-visual";

export type InjectionExplanation = {
  concentrationUnit: string;
  frequency: Frequency | null;
  syringeUnitMarkings?: string;
};

export function InjectionDoseExplanation({ meta, amount, details }: {
  meta: MedLogMeta;
  amount: number;
  details: InjectionExplanation;
}) {
  const isSavedDose = amount === meta.defaultAmount;
  const dose = injectionDoseDetails({
    doseAmount: amount, doseUnit: meta.defaultUnit,
    concentrationAmount: meta.concentrationAmount ?? 0,
    concentrationUnit: details.concentrationUnit,
    concentrationPerVolume: meta.concentrationPerVolume ?? 1,
    frequency: isSavedDose ? details.frequency : null,
  });
  if (!dose) return <p className="text-sm text-muted">Enter a valid dose and matching vial concentration to see the liquid volume.</p>;

  return <div className="space-y-3">
    <div aria-live="polite" className="space-y-2 rounded-md border border-line bg-surface p-4 text-sm leading-relaxed text-paper">
      <p className="font-medium">{isSavedDose ? "Your chosen dose" : "Amount to record"}: {explainedQuantity(dose.medicationAmount, 2)} {dose.medicationUnit} of medication.</p>
      <p>At {explainedQuantity(dose.perMl, 4)} {dose.medicationUnit} per mL, this equals <strong className="font-medium">{explainedQuantity(dose.volumeMl, 4)} mL of liquid</strong>.</p>
      {dose.medicationUnit !== "mL" && <p className="text-muted">mL measures the liquid volume; {dose.medicationUnit} measures the amount of medication it contains.</p>}
      {dose.weeklyDoses != null && dose.weeklyAmount != null && <p>Your chosen {dose.weeklyDoses === 1 ? "1 dose per week adds" : `${dose.weeklyDoses} doses per week add`} up to {explainedQuantity(dose.weeklyAmount, 2)} {dose.medicationUnit} per week.</p>}
      {!isSavedDose && <p className="text-muted">This amount differs from the dose in your saved plan.</p>}
    </div>
    <SyringeVisual
      doseAmount={dose.medicationAmount}
      concentrationAmount={meta.concentrationAmount ?? 0}
      concentrationPerVolume={meta.concentrationPerVolume ?? 1}
      syringeCapacityMl={meta.syringeCapacityMl ?? 0}
      syringeUnitMarkings={details.syringeUnitMarkings}
      showVolumeCaption={false}
    />
  </div>;
}
