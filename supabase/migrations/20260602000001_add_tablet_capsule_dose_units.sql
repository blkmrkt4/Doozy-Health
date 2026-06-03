-- Add 'tablet' and 'capsule' to the allowed dose units for solid oral forms.
-- The dose for a tablet/capsule is a COUNT ("take 1 tablet"); the per-unit
-- strength carries the active amount (PRD §5.11). Forward-only and
-- non-destructive: this only WIDENS the two regimen dose_unit checks, so no
-- existing row can violate the new constraint.

alter table public.prescribed_regimens
  drop constraint prescribed_regimens_dose_unit_check,
  add constraint prescribed_regimens_dose_unit_check
    check (dose_unit in (
      'mg','mcg','g','mL','IU','unit','grain','puff','drop','patch',
      'application','tablet','capsule'
    ));

alter table public.chosen_regimens
  drop constraint chosen_regimens_dose_unit_check,
  add constraint chosen_regimens_dose_unit_check
    check (dose_unit in (
      'mg','mcg','g','mL','IU','unit','grain','puff','drop','patch',
      'application','tablet','capsule'
    ));
