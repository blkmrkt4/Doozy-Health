-- Doozy Health — reminders engine (build sequence §13.12, PRD §5.5).
-- Creates dose_schedules (generation state per medication),
-- dose_reminders (materialised upcoming notifications), and
-- push_subscriptions (Web Push endpoint registrations).
--
-- Forward-only migration. Do not edit once applied.

set search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- dose_schedules — one per medication, tracks the schedule generation state.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.dose_schedules (
  id                     uuid primary key default gen_random_uuid(),
  medication_id          uuid not null references public.medications(id) on delete cascade,
  patient_id             uuid not null references public.patients(id) on delete cascade,
  next_due_at            timestamptz not null,
  generated_through      timestamptz not null,
  consolidation_window_min int not null default 30,
  escalation_delay_min   int,
  escalation_user_id     uuid references public.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (medication_id)
);

create trigger dose_schedules_set_updated_at
  before update on public.dose_schedules
  for each row execute function public.set_updated_at();

alter table public.dose_schedules enable row level security;

create policy dose_schedules_read on public.dose_schedules
  for select to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid()
    )
  );

create policy dose_schedules_owner_insert on public.dose_schedules
  for insert to authenticated
  with check (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

create policy dose_schedules_owner_update on public.dose_schedules
  for update to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

create policy dose_schedules_owner_delete on public.dose_schedules
  for delete to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- dose_reminders — materialised upcoming dose notifications.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.dose_reminders (
  id                uuid primary key default gen_random_uuid(),
  schedule_id       uuid not null references public.dose_schedules(id) on delete cascade,
  medication_id     uuid not null references public.medications(id) on delete cascade,
  patient_id        uuid not null references public.patients(id) on delete cascade,
  due_at            timestamptz not null,
  channel           text not null default 'push'
    check (channel in ('push', 'sms')),
  recipient_user_id uuid not null references public.users(id) on delete cascade,
  status            text not null default 'pending'
    check (status in ('pending', 'sent', 'acted', 'missed')),
  action_taken      text not null default 'none'
    check (action_taken in ('taken', 'snoozed', 'skipped', 'none')),
  action_at         timestamptz,
  consolidated_with uuid references public.dose_reminders(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index dose_reminders_due_idx
  on public.dose_reminders (due_at)
  where status = 'pending';
create index dose_reminders_schedule_idx
  on public.dose_reminders (schedule_id, due_at);

alter table public.dose_reminders enable row level security;

create policy dose_reminders_read on public.dose_reminders
  for select to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid()
    )
  );

-- Inserts via service role (schedule generator). No client insert policy.

create policy dose_reminders_member_update on public.dose_reminders
  for update to authenticated
  using (
    recipient_user_id = auth.uid()
    or patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- push_subscriptions — Web Push endpoint registrations per user.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_self_select on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

create policy push_subscriptions_self_insert on public.push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid());

create policy push_subscriptions_self_delete on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());
