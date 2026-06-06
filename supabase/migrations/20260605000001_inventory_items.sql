-- Doozy Health — inventory items (syringes for now). A syringe is supplies the
-- patient has on hand, not a medication (no dose/regimen). Patient-scoped with
-- the membership RLS predicate (PRD §7). Owner-only writes (PRD §5.6). An
-- injectable medication may reference its chosen syringe via medications.syringe_id,
-- which drives the calibrated syringe visual. Forward-only.
set search_path = public;

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  category text not null default 'syringe' check (category in ('syringe')),
  label text not null check (length(trim(label)) > 0),
  spec jsonb not null default '{}'::jsonb,   -- {capacity_mL, needle_gauge, needle_length_in, unit_markings}
  photo_document_id uuid references public.documents(id) on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, patient_id)
);

create index inventory_items_patient_active_idx
  on public.inventory_items (patient_id)
  where archived = false;

create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- The chosen syringe for an injectable medication (nullable).
alter table public.medications
  add column syringe_id uuid references public.inventory_items(id) on delete set null;

-- ── RLS — membership read, owner write (mirrors medications) ─────────────────
alter table public.inventory_items enable row level security;

create policy inventory_items_read on public.inventory_items
  for select to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid()
    )
  );

create policy inventory_items_owner_insert on public.inventory_items
  for insert to authenticated
  with check (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

create policy inventory_items_owner_update on public.inventory_items
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

create policy inventory_items_owner_delete on public.inventory_items
  for delete to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );
