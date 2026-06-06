-- Doozy Health — Notion-style diary upgrades (PRD §5.9): a multi-select field
-- type, per-medication scoping (a label/organizer), and one editable daily diary
-- entry per patient for the calendar's tap-through "Diary" twisty. Forward-only.
set search_path = public;

-- 1) Add the multiselect field type (value is a JSON array; reuses category_options).
alter table public.tracked_fields
  drop constraint if exists tracked_fields_field_type_check;
alter table public.tracked_fields
  add constraint tracked_fields_field_type_check
  check (field_type in ('number','scale_1_10','boolean','freetext','category','multiselect'));

-- 2) Per-medication scoping. A field with no rows here = general (all meds).
create table public.tracked_field_medications (
  tracked_field_id uuid not null references public.tracked_fields(id) on delete cascade,
  medication_id    uuid not null references public.medications(id) on delete cascade,
  patient_id       uuid not null references public.patients(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (tracked_field_id, medication_id)
);

create index tracked_field_medications_field_idx
  on public.tracked_field_medications (tracked_field_id);

alter table public.tracked_field_medications enable row level security;

create policy tfm_read on public.tracked_field_medications
  for select to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships where user_id = auth.uid()
    )
  );

create policy tfm_owner_insert on public.tracked_field_medications
  for insert to authenticated
  with check (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

create policy tfm_owner_delete on public.tracked_field_medications
  for delete to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- 3) One editable daily diary entry per patient (the calendar twisty). Ad-hoc
-- /diary entries keep entry_date null (multiple per day allowed).
alter table public.diary_entries add column entry_date date;

create unique index diary_entries_daily_uidx
  on public.diary_entries (patient_id, entry_date)
  where entry_date is not null;

-- Owners + caregivers can update an existing diary entry (the daily upsert).
create policy diary_entries_update on public.diary_entries
  for update to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role in ('owner', 'caregiver')
    )
  )
  with check (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role in ('owner', 'caregiver')
    )
  );
