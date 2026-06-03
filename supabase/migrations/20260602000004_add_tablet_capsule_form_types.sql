-- Add 'tablet' and 'capsule' as delivery form types: the dosage form is the
-- pill itself, not the bottle it came in. Forward-only and non-destructive —
-- only WIDENS the delivery_forms.form_type check, so no existing row can break.

alter table public.delivery_forms
  drop constraint delivery_forms_form_type_check,
  add constraint delivery_forms_form_type_check
    check (form_type in (
      'tablet','capsule','vial','patch','pill_bottle','suppository',
      'topical','inhaler','sublingual'
    ));
