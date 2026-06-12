-- Single-use / OTC medication logging (PRD §5.10.1 Phase B). Lets a user quickly
-- record a one-off, not-in-inventory medication (Tylenol, ibuprofen, NyQuil) so
-- it counts toward the report and the curated interaction check. These are
-- lightweight `single_use` medication rows with no regimen — just a PRN dose log.
-- They are hidden from the main medications list but their canonical_drug_id
-- flows into interactions + the Snapshot automatically.
--
-- Logging a one-off is a LOGGING action (like dose logging), so owners AND
-- caregivers may do it (write model §5.6) — but medications insert is owner-only
-- via RLS. So this is a SECURITY DEFINER function with an explicit owner/caregiver
-- gate (viewers excluded), the same shape as the dose-log write rule. Forward-only.

set search_path = public;

alter table public.medications
  add column single_use boolean not null default false;

-- Find-or-create the single-use medication for a drug, then insert the PRN dose
-- log, atomically. Gated to owner/caregiver inside the function (definer rights).
create or replace function public.log_single_use_dose(
  p_patient_id uuid,
  p_display_name text,
  p_canonical_drug_id uuid,
  p_amount numeric,
  p_unit text,
  p_route text,
  p_note text,
  p_logged_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_med_id uuid;
  v_log_id uuid;
begin
  -- Owner or caregiver only (same write model as dose logging, §5.6).
  select role into v_role
    from public.patient_memberships
    where patient_id = p_patient_id and user_id = auth.uid();
  if v_role is null or v_role = 'viewer' then
    raise exception 'not authorized to log for this patient';
  end if;

  if trim(coalesce(p_display_name, '')) = '' then
    raise exception 'display name required';
  end if;
  if p_amount is null or p_amount <= 0 or trim(coalesce(p_unit, '')) = '' then
    raise exception 'amount and unit required';
  end if;

  -- Reuse one single-use row per drug (or per name when the drug is unresolved).
  if p_canonical_drug_id is not null then
    select id into v_med_id from public.medications
      where patient_id = p_patient_id and single_use = true
        and canonical_drug_id = p_canonical_drug_id
      limit 1;
  else
    select id into v_med_id from public.medications
      where patient_id = p_patient_id and single_use = true
        and lower(display_name) = lower(p_display_name)
      limit 1;
  end if;

  if v_med_id is null then
    insert into public.medications
      (patient_id, display_name, is_private, entry_source, single_use, canonical_drug_id)
    values
      (p_patient_id, p_display_name, false, 'manual', true, p_canonical_drug_id)
    returning id into v_med_id;
  end if;

  insert into public.dose_logs
    (medication_id, patient_id, event_type, amount, unit, route_taken, note,
     source, logged_by_user_id, logged_at)
  values
    (v_med_id, p_patient_id, 'prn', p_amount, p_unit, nullif(p_route, ''),
     nullif(p_note, ''),
     case when v_role = 'caregiver' then 'caregiver' else 'manual' end,
     auth.uid(),
     coalesce(p_logged_at, now()))
  returning id into v_log_id;

  return v_log_id;
end;
$$;

revoke all on function public.log_single_use_dose(uuid, text, uuid, numeric, text, text, text, timestamptz) from public;
grant execute on function public.log_single_use_dose(uuid, text, uuid, numeric, text, text, text, timestamptz) to authenticated;
