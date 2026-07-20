-- Caregiver escalation events join the in-app notification feed (PRD §5.5):
-- when a reminded dose stays unlogged past the schedule's escalation delay,
-- the push to the named caregiver now also leaves a factual in-app record.
-- Widen the type check constraint; everything else is unchanged.

set search_path = public;

alter table public.notifications
  drop constraint notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check check (type in (
    'supply_low_medication', 'supply_low_item', 'interaction',
    'dose_above_prescribed', 'dose_escalation'
  ));
