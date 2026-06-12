-- In-app notifications (PRD §4.6/§5.5 surface; facts from §5.10.1 + §5.8).
-- Rows are SYSTEM-generated from deterministic facts (supply projections,
-- curated interactions, doses-above-regimen) inside server actions — never by
-- an LLM and never directly by a client. Copy is NOT stored: rows carry a
-- structured payload and the strings render at display time from one
-- reviewable module (lib/notifications.ts), so §6.1 copy fixes apply
-- retroactively. Dedupe is structural: unique (patient_id, dedupe_key) with
-- the cooldown encoded in the key's bucket (e.g. one notification per fill).
-- Forward-only.
set search_path = public;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  type text not null check (type in (
    'supply_low_medication', 'supply_low_item', 'interaction', 'dose_above_prescribed'
  )),
  severity text not null check (severity in ('info', 'caution', 'serious')),
  -- Source refs. medication_id doubles as the privacy gate: when set, the
  -- read policy hides the row from members who can't read that medication.
  medication_id uuid,
  inventory_item_id uuid references public.inventory_items(id) on delete cascade,
  report_summary_id uuid references public.report_summaries(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null check (length(trim(dedupe_key)) > 0),
  created_at timestamptz not null default now(),
  -- Composite FK keeps a medication ref from pointing across patients.
  foreign key (medication_id, patient_id)
    references public.medications (id, patient_id) on delete cascade,
  unique (patient_id, dedupe_key)
);

create index notifications_patient_created_idx
  on public.notifications (patient_id, created_at desc);

-- Notifications are immutable facts: no updated_at, no UPDATE policy.

-- Per-user read marks. Read state is per member (an owner reading a
-- notification must not clear a caregiver's dot), while the notification row
-- itself stays patient-scoped so later-invited caregivers see history and
-- removed members lose it via the membership predicate automatically.
create table public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;

-- Membership read plus the medication-privacy override: a notification about
-- a private medication is visible to owners only (can_read_medication is the
-- same SECURITY DEFINER helper the other medication-child tables use).
create policy notifications_read on public.notifications
  for select to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid()
    )
    and (
      medication_id is null
      or public.can_read_medication(medication_id)
    )
  );

-- Deliberately NO insert/update policy for authenticated: rows are written by
-- the server with the service-role client only, so clients can't forge them.

-- Permanent dismiss is an owner action.
create policy notifications_owner_delete on public.notifications
  for delete to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- Read marks: each user manages only their own, and only for notifications
-- they can currently see (the sub-select runs under notifications' RLS).
create policy notification_reads_select on public.notification_reads
  for select to authenticated
  using (user_id = auth.uid());

create policy notification_reads_insert on public.notification_reads
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and notification_id in (select id from public.notifications)
  );
