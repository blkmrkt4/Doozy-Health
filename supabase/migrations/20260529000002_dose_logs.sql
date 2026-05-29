-- Doozy Health — dose logging (build sequence §13.4; PRD §5.4, §4.3, §8).
--
-- One row per logged event. event_type extends §8's field list (which lists
-- only "amount") to faithfully support §5.4's three paths: a 'taken' or 'prn'
-- dose carries an amount + unit; a 'skipped' event carries neither (a CHECK
-- enforces this). scheduled_for stays null until the schedule generator lands
-- (step 12) — for now the one-tap "took the scheduled dose" reads the dose
-- from the active chosen regimen.
--
-- Caregivers can log (PRD §5.6) — the first table whose write policy admits a
-- non-owner role. Visibility still honours is_private via can_read_medication,
-- so a caregiver can neither see nor log a private medication.
--
-- Dose amounts are numeric, never float (CLAUDE.md). Forward-only migration.

set search_path = public;

create table public.dose_logs (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null,
  patient_id uuid not null,
  event_type text not null default 'taken'
    check (event_type in ('taken','skipped','prn')),
  scheduled_for timestamptz,                 -- nullable (PRN; or no schedule yet)
  logged_at timestamptz not null default now(),
  amount numeric check (amount is null or amount > 0),
  unit text,
  route_taken text
    check (route_taken is null or route_taken in
      ('oral','sublingual','intramuscular','subcutaneous','transdermal','suppository','topical','inhaled')),
  site text,
  note text,
  source text not null default 'manual'
    check (source in ('manual','reminder_action','caregiver')),
  logged_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (medication_id, patient_id)
    references public.medications (id, patient_id) on delete cascade,
  -- A skip records no amount; a taken/PRN dose must record amount + unit.
  constraint dose_logs_amount_by_event check (
    (event_type = 'skipped' and amount is null and unit is null)
    or (event_type in ('taken','prn') and amount is not null and unit is not null)
  )
);

create index dose_logs_medication_idx
  on public.dose_logs (medication_id, logged_at desc);
create index dose_logs_patient_idx
  on public.dose_logs (patient_id, logged_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.dose_logs enable row level security;

-- Read: same visibility as the parent medication (membership + is_private).
create policy dose_logs_read on public.dose_logs
  for select to authenticated
  using (public.can_read_medication(medication_id));

-- Insert: an owner OR caregiver of the patient, who can see the medication,
-- logging as themselves. (Caregivers cannot log a private med — can_read_*
-- returns false for them.)
create policy dose_logs_insert on public.dose_logs
  for insert to authenticated
  with check (
    logged_by_user_id = auth.uid()
    and public.can_read_medication(medication_id)
    and patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role in ('owner','caregiver')
    )
  );

-- Delete (undo a mistaken log): the person who logged it, or an owner.
create policy dose_logs_delete on public.dose_logs
  for delete to authenticated
  using (
    logged_by_user_id = auth.uid()
    or patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );
