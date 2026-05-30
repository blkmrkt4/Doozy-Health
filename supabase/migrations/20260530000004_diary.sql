-- Doozy Health — diary / custom tracking fields (build sequence §13.15, PRD §5.9).
-- Creates tracked_fields (per-patient field configuration) and diary_entries
-- (structured tracking entries, optionally attached to a dose log).
--
-- Forward-only migration. Do not edit once applied.

set search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- tracked_fields — per-patient configurable tracking fields (Notion-style).
-- Field types: number, scale_1_10, boolean, freetext, category.
-- No imposed defaults — suggest_diary_fields proposes, user picks (PRD §5.9).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.tracked_fields (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references public.patients(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  field_type       text not null
    check (field_type in ('number', 'scale_1_10', 'boolean', 'freetext', 'category')),
  unit             text,
  category_options jsonb,  -- array of strings for category type, null otherwise
  display_order    int not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger tracked_fields_set_updated_at
  before update on public.tracked_fields
  for each row execute function public.set_updated_at();

create index tracked_fields_patient_idx
  on public.tracked_fields (patient_id, display_order)
  where active = true;

alter table public.tracked_fields enable row level security;

create policy tracked_fields_read on public.tracked_fields
  for select to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid()
    )
  );

create policy tracked_fields_owner_insert on public.tracked_fields
  for insert to authenticated
  with check (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

create policy tracked_fields_owner_update on public.tracked_fields
  for update to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

create policy tracked_fields_owner_delete on public.tracked_fields
  for delete to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- diary_entries — structured tracking entries with per-field values stored
-- as jsonb keyed by tracked_field_id. Can attach to a dose_log or stand free.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.diary_entries (
  id                    uuid primary key default gen_random_uuid(),
  patient_id            uuid not null references public.patients(id) on delete cascade,
  entry_at              timestamptz not null default now(),
  field_values          jsonb not null default '{}'::jsonb,
  attached_dose_log_id  uuid references public.dose_logs(id) on delete set null,
  note                  text,
  logged_by_user_id     uuid not null references public.users(id) on delete cascade,
  created_at            timestamptz not null default now()
);

create index diary_entries_patient_idx
  on public.diary_entries (patient_id, entry_at desc);
create index diary_entries_dose_log_idx
  on public.diary_entries (attached_dose_log_id)
  where attached_dose_log_id is not null;

alter table public.diary_entries enable row level security;

create policy diary_entries_read on public.diary_entries
  for select to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid()
    )
  );

-- Owners and caregivers can create diary entries (same as dose logging).
create policy diary_entries_insert on public.diary_entries
  for insert to authenticated
  with check (
    logged_by_user_id = auth.uid()
    and patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role in ('owner', 'caregiver')
    )
  );

create policy diary_entries_delete on public.diary_entries
  for delete to authenticated
  using (
    logged_by_user_id = auth.uid()
    or patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );
