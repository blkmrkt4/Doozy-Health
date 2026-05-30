-- Doozy Health — v0.4 PRD expansion. Adds new drugs table columns for the
-- kernel library / linearity gate / uncertainty band / metabolites (§5.7),
-- the pk_calibrations table (§4.8), exports tracking (§8), and the per-user
-- extraction correction signal (§5.2.3).
--
-- Forward-only migration. Do not edit once applied.

set search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Expand drugs table with v0.4 PK engine fields (§5.7, §8)
-- ─────────────────────────────────────────────────────────────────────────────

-- Half-life population range for uncertainty band: { route: [low, high] }
alter table public.drugs
  add column if not exists half_life_range_hours jsonb not null default '{}'::jsonb;

-- Per-route kernel selection: { route: 'exponential' | 'bateman' | 'zeroOrder' }
alter table public.drugs
  add column if not exists kernel_by_route jsonb not null default '{}'::jsonb;

-- Release duration for zero-order kernels (patches, implants): { route: hours }
alter table public.drugs
  add column if not exists release_duration_hours jsonb not null default '{}'::jsonb;

-- Linearity gate (§5.7): non-linear drugs get "can't model" instead of a curve
alter table public.drugs
  add column if not exists is_linear boolean not null default true;

-- Reason shown to the user when is_linear = false
alter table public.drugs
  add column if not exists nonlinear_reason text;

-- Active metabolites: array of {name, fraction, kernel, half_life_hours, tmax_hours}
alter table public.drugs
  add column if not exists metabolites jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- pk_calibrations — user-entered readings for personal curve calibration
-- (§4.8, §5.7, §8). Patient-scoped, honours is_private on the linked
-- medication. The derived personal half-life is computed at render time
-- and never overwrites the reference drugs value.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.pk_calibrations (
  id                uuid primary key default gen_random_uuid(),
  patient_id        uuid not null references public.patients(id) on delete cascade,
  medication_id     uuid not null references public.medications(id) on delete cascade,
  value             numeric not null,
  unit              text not null,
  observed_at       timestamptz not null,
  note              text,
  logged_by_user_id uuid not null references public.users(id) on delete cascade,
  created_at        timestamptz not null default now()
);

create index pk_calibrations_medication_idx
  on public.pk_calibrations (medication_id, observed_at);

alter table public.pk_calibrations enable row level security;

-- Readable if the caller is a member AND the linked medication is visible
-- (honours is_private via can_read_medication).
create policy pk_calibrations_read on public.pk_calibrations
  for select to authenticated
  using (public.can_read_medication(medication_id));

-- Owner and caregiver can insert (same as dose logging).
create policy pk_calibrations_insert on public.pk_calibrations
  for insert to authenticated
  with check (
    logged_by_user_id = auth.uid()
    and patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role in ('owner', 'caregiver')
    )
  );

-- Logger or owner can delete.
create policy pk_calibrations_delete on public.pk_calibrations
  for delete to authenticated
  using (
    logged_by_user_id = auth.uid()
    or patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- exports — tracks generated PDF/JSON exports (§8).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.exports (
  id                    uuid primary key default gen_random_uuid(),
  patient_id            uuid not null references public.patients(id) on delete cascade,
  generated_by_user_id  uuid not null references public.users(id) on delete cascade,
  date_range_start      date not null,
  date_range_end        date not null,
  medications_included  jsonb not null default '[]'::jsonb,
  fields_included       jsonb not null default '[]'::jsonb,
  output_storage_path   text,
  generated_at          timestamptz not null default now()
);

alter table public.exports enable row level security;

create policy exports_read on public.exports
  for select to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid()
    )
  );

create policy exports_insert on public.exports
  for insert to authenticated
  with check (
    generated_by_user_id = auth.uid()
    and patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- user_extraction_corrections — per-user correction signal (§5.2.3).
-- When a user repeatedly edits the same field for the same drug, the count
-- grows. Patient-scoped — does not flow into system-wide extraction_deltas.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.user_extraction_corrections (
  id                  uuid primary key default gen_random_uuid(),
  patient_id          uuid not null references public.patients(id) on delete cascade,
  drug_canonical_name text not null,
  field_name          text not null,
  corrected_to        text not null,
  correction_count    int not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (patient_id, drug_canonical_name, field_name)
);

create trigger user_extraction_corrections_set_updated_at
  before update on public.user_extraction_corrections
  for each row execute function public.set_updated_at();

alter table public.user_extraction_corrections enable row level security;

create policy user_corrections_read on public.user_extraction_corrections
  for select to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid()
    )
  );

-- Service-role insert/update (from the extraction confirmation path).
