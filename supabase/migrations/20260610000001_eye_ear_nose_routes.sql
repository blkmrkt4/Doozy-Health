-- Add ophthalmic / otic / nasal routes so eye drops (e.g. latanoprost), ear
-- drops, and nasal sprays can be recorded with a correct route. Forward-only:
-- widen the three route CHECK constraints to include the new values. Existing
-- rows are unaffected (the set only grows). Keep in sync with lib/types.ts ROUTES.

alter table public.prescribed_regimens
  drop constraint prescribed_regimens_route_check,
  add constraint prescribed_regimens_route_check
    check (route in ('oral','sublingual','intramuscular','subcutaneous',
                     'transdermal','suppository','topical','inhaled',
                     'ophthalmic','otic','nasal'));

alter table public.chosen_regimens
  drop constraint chosen_regimens_route_check,
  add constraint chosen_regimens_route_check
    check (route in ('oral','sublingual','intramuscular','subcutaneous',
                     'transdermal','suppository','topical','inhaled',
                     'ophthalmic','otic','nasal'));

alter table public.dose_logs
  drop constraint dose_logs_route_taken_check,
  add constraint dose_logs_route_taken_check
    check (route_taken is null or route_taken in
             ('oral','sublingual','intramuscular','subcutaneous',
              'transdermal','suppository','topical','inhaled',
              'ophthalmic','otic','nasal'));
