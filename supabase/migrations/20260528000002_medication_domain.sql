-- Doozy Health — medication domain, manual entry (build sequence §13.2).
-- Implements the three-layer regimen model (PRD §5.3, §8): a medication holds
-- a PrescribedRegimen (what the doctor wrote), a DeliveryForm (the physical
-- thing in hand), and a ChosenRegimen (how the user actually takes it).
--
-- SCOPING (CLAUDE.md scoping rule + hard rule #5): every patient-owned table
-- carries patient_id and is guarded by the membership predicate
--   patient_id in (select patient_id from patient_memberships where user_id = auth.uid())
-- The regimen/form children also carry patient_id (PRD §8's key-field lists
-- show only medication_id; the scoping rule adds patient_id across the board).
-- A composite FK (medication_id, patient_id) -> medications(id, patient_id)
-- guarantees a child can never point at a medication of a different patient.
--
-- is_private (PRD §5.6) is enforced inside the RLS predicate, not just the UI:
-- non-owners (caregiver/viewer) cannot read a medication flagged private even
-- with a direct query.
--
-- "Drug name free text for now" (§13.2): canonical_drug_id is reserved for the
-- reference drugs table that arrives in step 3; no FK yet.
--
-- Forward-only migration. Do not edit once applied.

set search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- medications — the patient-scoped record. display_name is free text until the
-- reference drugs table lands (step 3); canonical_drug_id is then back-filled.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.medications (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  canonical_drug_id uuid,            -- FK to drugs added in step 3
  display_name text not null check (length(trim(display_name)) > 0),
  is_private boolean not null default false,
  entry_source text not null default 'manual'
    check (entry_source in ('manual','photo')),  -- flags manual meds (PRD §4.2.5)
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target for the children's composite FK so patient_id can't drift.
  unique (id, patient_id)
);

create index medications_patient_active_idx
  on public.medications (patient_id)
  where archived = false;

create trigger medications_set_updated_at
  before update on public.medications
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- prescribed_regimens — what the prescription says. Immutable per prescription:
-- a new prescription is a NEW row, never an overwrite (PRD §5.3). No UPDATE
-- policy below by design.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.prescribed_regimens (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null,
  patient_id uuid not null,
  dose_amount numeric not null check (dose_amount > 0),
  dose_unit text not null
    check (dose_unit in ('mg','mcg','g','mL','IU','unit','grain','puff','drop','patch','application')),
  frequency jsonb not null,          -- cadence shape: see lib/types.ts Frequency
  route text not null
    check (route in ('oral','sublingual','intramuscular','subcutaneous','transdermal','suppository','topical','inhaled')),
  duration_days integer check (duration_days is null or duration_days > 0),
  prescriber_name text,
  prescription_document_id uuid,     -- FK to documents added in step 5
  created_at timestamptz not null default now(),
  foreign key (medication_id, patient_id)
    references public.medications (id, patient_id) on delete cascade
);

create index prescribed_regimens_medication_idx
  on public.prescribed_regimens (medication_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- delivery_forms — the physical thing in hand. Replaced when the user gets a
-- new fill at a different concentration (a new row).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.delivery_forms (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null,
  patient_id uuid not null,
  form_type text not null
    check (form_type in ('vial','patch','pill_bottle','suppository','topical','inhaler','sublingual')),
  concentration jsonb,               -- {amount, unit, per_volume, volume_unit}
  package_count numeric check (package_count is null or package_count > 0),
  package_unit text,
  syringe_spec jsonb,                -- {capacity_mL, needle_gauge, needle_length_in, unit_markings}
  expiry_date date,
  batch text,
  manufacturer text,
  source_photo_id uuid,              -- FK to documents added in step 5
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (medication_id, patient_id)
    references public.medications (id, patient_id) on delete cascade
);

create index delivery_forms_medication_idx
  on public.delivery_forms (medication_id, created_at desc);

create trigger delivery_forms_set_updated_at
  before update on public.delivery_forms
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- chosen_regimens — how the user takes it. Drives reminders (step 12) and the
-- PK chart (step 11). Exactly one active row per medication.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.chosen_regimens (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null,
  patient_id uuid not null,
  dose_amount numeric not null check (dose_amount > 0),
  dose_unit text not null
    check (dose_unit in ('mg','mcg','g','mL','IU','unit','grain','puff','drop','patch','application')),
  frequency jsonb not null,
  route text not null
    check (route in ('oral','sublingual','intramuscular','subcutaneous','transdermal','suppository','topical','inhaled')),
  reason_note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (medication_id, patient_id)
    references public.medications (id, patient_id) on delete cascade
);

-- Only one active chosen regimen per medication (PRD §8).
create unique index chosen_regimens_one_active
  on public.chosen_regimens (medication_id)
  where active;

create index chosen_regimens_medication_idx
  on public.chosen_regimens (medication_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Visibility helper for the CHILD tables (prescribed/delivery/chosen), which
-- carry only medication_id and must look up the parent's is_private flag.
-- SECURITY DEFINER so child policies apply the membership + is_private rule
-- without re-joining medications themselves. Returns true iff the caller may
-- READ the medication: a member of the patient AND (not private OR an owner).
--
-- NOTE: the medications table does NOT use this for its own SELECT policy.
-- A SELECT policy that re-queries its own table by id is unsatisfiable during
-- INSERT ... RETURNING (the just-inserted row isn't yet visible to the
-- sub-select), which would block every insert that returns the new row — and
-- the create_manual_medication RPC's `returning id`. The medications policy
-- below therefore tests the row's own columns directly.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.can_read_medication(p_medication_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.medications m
    where m.id = p_medication_id
      and m.patient_id in (
        select patient_id from public.patient_memberships
        where user_id = auth.uid()
      )
      and (
        m.is_private = false
        or m.patient_id in (
          select patient_id from public.patient_memberships
          where user_id = auth.uid() and role = 'owner'
        )
      )
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.medications enable row level security;
alter table public.prescribed_regimens enable row level security;
alter table public.delivery_forms enable row level security;
alter table public.chosen_regimens enable row level security;

-- medications: SELECT tests the row's own columns directly (see the NOTE on
-- can_read_medication above for why this can't re-query medications by id).
-- This is the membership predicate plus the is_private override (PRD §5.6):
-- a member sees the row, but a non-owner cannot see it when it's private.
create policy medications_read on public.medications
  for select to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid()
    )
    and (
      is_private = false
      or patient_id in (
        select patient_id from public.patient_memberships
        where user_id = auth.uid() and role = 'owner'
      )
    )
  );

create policy medications_owner_insert on public.medications
  for insert to authenticated
  with check (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

create policy medications_owner_update on public.medications
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

-- Child tables share one shape: read iff the parent medication is readable;
-- write iff the caller owns the patient (the composite FK guarantees the
-- medication belongs to that same patient).
create policy prescribed_read on public.prescribed_regimens
  for select to authenticated
  using (public.can_read_medication(medication_id));
create policy prescribed_owner_insert on public.prescribed_regimens
  for insert to authenticated
  with check (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );
-- (No UPDATE/DELETE on prescribed_regimens — immutable per prescription.)

create policy delivery_read on public.delivery_forms
  for select to authenticated
  using (public.can_read_medication(medication_id));
create policy delivery_owner_insert on public.delivery_forms
  for insert to authenticated
  with check (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );
create policy delivery_owner_update on public.delivery_forms
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

create policy chosen_read on public.chosen_regimens
  for select to authenticated
  using (public.can_read_medication(medication_id));
create policy chosen_owner_insert on public.chosen_regimens
  for insert to authenticated
  with check (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );
create policy chosen_owner_update on public.chosen_regimens
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
