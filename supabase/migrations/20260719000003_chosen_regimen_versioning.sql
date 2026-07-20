-- Chosen-regimen versioning (PRD §5.3, §5.6). "How you take it" changes over
-- time — dose splits, interval changes, adjustments after labs — and that
-- history is exactly what a dose-adjustment conversation with a clinician
-- needs. The schema was already shaped for this (active flag + the
-- chosen_regimens_one_active partial unique index); this migration adds
-- attribution and an atomic swap so the edit path can insert a new version
-- instead of overwriting the only row.
--
-- SECURITY INVOKER, like create_manual_medication: both statements inside are
-- checked against the owner-only chosen_owner_update / chosen_owner_insert
-- policies — the function adds atomicity, not privilege.

set search_path = public;

alter table public.chosen_regimens
  add column changed_by_user_id uuid references public.users(id);

comment on column public.chosen_regimens.changed_by_user_id is
  'Who recorded this version; null for rows predating versioning.';

create or replace function public.replace_chosen_regimen(
  p_medication_id uuid,
  p_dose_amount numeric,
  p_dose_unit text,
  p_frequency jsonb,
  p_route text,
  p_reason_note text
)
returns uuid
language plpgsql
as $$
declare
  v_patient_id uuid;
  v_new_id uuid;
begin
  -- The active row also tells us the patient scope; RLS on the update below
  -- is what actually enforces ownership.
  select patient_id into v_patient_id
    from public.chosen_regimens
    where medication_id = p_medication_id and active
    limit 1;
  if v_patient_id is null then
    raise exception 'No active chosen regimen for this medication';
  end if;

  update public.chosen_regimens
    set active = false
    where medication_id = p_medication_id and active;

  insert into public.chosen_regimens
    (medication_id, patient_id, dose_amount, dose_unit, frequency, route,
     reason_note, active, changed_by_user_id)
  values
    (p_medication_id, v_patient_id, p_dose_amount, p_dose_unit, p_frequency,
     p_route, nullif(p_reason_note, ''), true, auth.uid())
  returning id into v_new_id;

  return v_new_id;
end;
$$;
