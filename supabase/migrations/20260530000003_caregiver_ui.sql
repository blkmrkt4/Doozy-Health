-- Doozy Health — caregiver UI RLS policies (build sequence §13.13).
-- Adds membership write policies deferred from step 1, plus a co-member
-- visibility helper so the caregivers settings page can list all members
-- of a shared patient without RLS self-recursion.
--
-- Forward-only migration. Do not edit once applied.

set search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Co-member visibility: a SECURITY DEFINER helper that returns membership
-- rows for patients the caller shares. Avoids RLS self-recursion that would
-- occur if a SELECT policy on patient_memberships referenced itself.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.shared_patient_memberships(caller_uid uuid)
returns setof public.patient_memberships
language sql
stable
security definer
set search_path = public
as $$
  select pm.*
  from public.patient_memberships pm
  where pm.patient_id in (
    select patient_id from public.patient_memberships
    where user_id = caller_uid
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Membership write policies (deferred from step 1, §13.13).
-- ─────────────────────────────────────────────────────────────────────────────

-- Owners can invite (insert a membership for their patient).
create policy memberships_owner_insert on public.patient_memberships
  for insert to authenticated
  with check (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- Owners can change roles (update a membership on their patient).
create policy memberships_owner_update on public.patient_memberships
  for update to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- Owners can revoke (delete a membership on their patient).
-- Cannot delete own membership (enforced in the server action, not RLS).
create policy memberships_owner_delete on public.patient_memberships
  for delete to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );
