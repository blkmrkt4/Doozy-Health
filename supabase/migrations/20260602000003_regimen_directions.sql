-- Persist the verbatim dosing instructions ("Take 1 tablet by mouth every
-- morning") on the prescribed regimen, so a caregiver — possibly managing
-- several patients — can see what was captured at entry, on an ongoing basis,
-- not only at review time (PRD §5.3). Forward-only and non-destructive: a
-- nullable ADD COLUMN plus a CREATE OR REPLACE of the RPC to store it.

alter table public.prescribed_regimens
  add column if not exists directions text;

create or replace function public.create_manual_medication(
  p_patient_id uuid,
  p_display_name text,
  p_is_private boolean,
  p_prescribed jsonb,
  p_delivery jsonb,
  p_chosen jsonb,
  p_canonical_drug_id uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_med_id uuid;
begin
  insert into public.medications
    (patient_id, canonical_drug_id, display_name, is_private, entry_source)
  values
    (p_patient_id, p_canonical_drug_id, p_display_name,
     coalesce(p_is_private, false), 'manual')
  returning id into v_med_id;

  insert into public.prescribed_regimens
    (medication_id, patient_id, dose_amount, dose_unit, frequency, route,
     duration_days, prescriber_name, directions)
  values
    (v_med_id, p_patient_id,
     (p_prescribed->>'dose_amount')::numeric,
     p_prescribed->>'dose_unit',
     p_prescribed->'frequency',
     p_prescribed->>'route',
     nullif(p_prescribed->>'duration_days', '')::integer,
     nullif(p_prescribed->>'prescriber_name', ''),
     nullif(p_prescribed->>'directions', ''));

  insert into public.delivery_forms
    (medication_id, patient_id, form_type, concentration, package_count,
     package_unit, syringe_spec, expiry_date, batch, manufacturer)
  values
    (v_med_id, p_patient_id,
     p_delivery->>'form_type',
     p_delivery->'concentration',
     nullif(p_delivery->>'package_count', '')::numeric,
     nullif(p_delivery->>'package_unit', ''),
     p_delivery->'syringe_spec',
     nullif(p_delivery->>'expiry_date', '')::date,
     nullif(p_delivery->>'batch', ''),
     nullif(p_delivery->>'manufacturer', ''));

  insert into public.chosen_regimens
    (medication_id, patient_id, dose_amount, dose_unit, frequency, route,
     reason_note, active)
  values
    (v_med_id, p_patient_id,
     (p_chosen->>'dose_amount')::numeric,
     p_chosen->>'dose_unit',
     p_chosen->'frequency',
     p_chosen->>'route',
     nullif(p_chosen->>'reason_note', ''),
     true);

  return v_med_id;
end;
$$;
