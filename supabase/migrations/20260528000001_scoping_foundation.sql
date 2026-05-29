-- Doozy Health — scoping foundation (build sequence §13.1).
-- Implements the patient / membership model from PRD §7 and §8.
--
-- DEPARTURE FROM THE INHERITED NUMARA SCHEMA (PRD §7, CLAUDE.md hard rule #5):
-- Numara is one-household-per-user — a single `users.household_id` FK plus a
-- `current_household_id()` helper drives table defaults, RLS, and storage
-- folders. That cannot express Doozy's caregiver model, where a patient and a
-- user are many-to-many. So:
--   * there is NO single-scope FK on `users` and NO `current_patient_id()`
--     helper — the active patient lives in app session state, never the DB;
--   * every patient-owned table (added in later migrations) carries
--     `patient_id` and uses the membership RLS predicate:
--       patient_id in (select patient_id from public.patient_memberships
--                      where user_id = auth.uid())
--
-- Forward-only migration. Do not edit once applied.

set search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger helper (used by every mutable table going forward)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- patients — the tracked person. The scope anchor for all health data.
-- A patient is reachable by one or more users via patient_memberships.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  date_of_birth date,
  default_unit_system text not null default 'metric'
    check (default_unit_system in ('metric','imperial')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger patients_set_updated_at
  before update on public.patients
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- users — application profile, 1:1 with auth.users via shared id.
-- No household_id and no patient role here: a user's relationship to a patient
-- is expressed per-patient on patient_memberships. is_system_admin gates
-- /admin (PRD §14.1) and is independent of any patient role.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  is_system_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- patient_memberships — the many-to-many join and the RLS anchor for
-- everything patient-scoped. One row per (patient, user) pair.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.patient_memberships (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'owner'
    check (role in ('owner','caregiver','viewer')),
  invited_by uuid references public.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (patient_id, user_id)
);

create index patient_memberships_user_idx
  on public.patient_memberships (user_id);
create index patient_memberships_patient_idx
  on public.patient_memberships (patient_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- is_current_system_admin() — admin gate used by every admin RLS policy
-- (PRD §14.1). Defined now; the admin tables that use it land in step 6.
-- SECURITY DEFINER so the policy can read users without granting the caller
-- broad select on it.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_current_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_system_admin from public.users where id = auth.uid()),
    false
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.patients enable row level security;
alter table public.users enable row level security;
alter table public.patient_memberships enable row level security;

-- users: a user reads/updates only their own profile row.
create policy users_self_select on public.users
  for select to authenticated
  using (id = auth.uid());

create policy users_self_update on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- patient_memberships: a user sees only their own membership rows.
-- (Co-member visibility on a shared patient — needed by the step-13 caregiver
-- UI — will be added then via a SECURITY DEFINER helper to avoid RLS
-- self-recursion. Step 1 only needs the caller's own rows.)
create policy memberships_self_select on public.patient_memberships
  for select to authenticated
  using (user_id = auth.uid());

-- patients: THE MEMBERSHIP PREDICATE. A user reads a patient iff they hold a
-- membership for it; only an owner may update the patient record.
create policy patients_member_select on public.patients
  for select to authenticated
  using (
    id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid()
    )
  );

create policy patients_owner_update on public.patients
  for update to authenticated
  using (
    id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- No client insert/delete policies on any of these tables. Initial
-- provisioning is done by the on-signup trigger below (SECURITY DEFINER);
-- caregiver invitations come through server actions in step 13.

-- ─────────────────────────────────────────────────────────────────────────────
-- Auto-provision: on auth.users signup, create the profile row, a patient,
-- and an owner membership (PRD §13.1). Patient name defaults to the email
-- local-part; the owner can rename it later.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_patient_id uuid;
  patient_label text;
begin
  patient_label := coalesce(
    nullif(split_part(new.email, '@', 1), ''),
    'My profile'
  );

  insert into public.users (id, email)
  values (new.id, new.email);

  insert into public.patients (name)
  values (patient_label)
  returning id into new_patient_id;

  insert into public.patient_memberships (patient_id, user_id, role, accepted_at)
  values (new_patient_id, new.id, 'owner', now());

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
