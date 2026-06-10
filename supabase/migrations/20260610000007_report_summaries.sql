-- Cached clinical narrative summaries for the doctor report (PRD §5.10.1). The
-- summary is generated once via a server action (one LLM call) and stored here
-- so the HTML report and the Puppeteer PDF render the SAME text without each
-- re-billing the model. Keyed by patient + date range; regenerating upserts.
-- `facts_hash` lets the UI tell the reader when the cache no longer matches the
-- current data. Membership-scoped RLS (PRD §7); owners + caregivers may write,
-- viewers may not (write model §5.6). Forward-only.

set search_path = public;

create table public.report_summaries (
  id                   uuid primary key default gen_random_uuid(),
  patient_id           uuid not null references public.patients(id) on delete cascade,
  from_date            date not null,
  to_date              date not null,
  facts_hash           text not null,
  -- The parsed narrative sections (overview / medications / adherence_notes /
  -- diary_observations / correlation_observations / data_caveats).
  summary              jsonb not null,
  model_used           text,
  generated_by_user_id uuid references public.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- One cached summary per patient + range; regenerate replaces it (upsert).
create unique index report_summaries_range_uidx
  on public.report_summaries (patient_id, from_date, to_date);

create trigger report_summaries_set_updated_at
  before update on public.report_summaries
  for each row execute function public.set_updated_at();

alter table public.report_summaries enable row level security;

create policy report_summaries_read on public.report_summaries
  for select to authenticated
  using (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid()
    )
  );

-- Owners + caregivers can generate (insert) a summary — same write model as
-- dose logs / diary entries (PRD §5.6). Viewers cannot.
create policy report_summaries_insert on public.report_summaries
  for insert to authenticated
  with check (
    patient_id in (
      select patient_id from public.patient_memberships
      where user_id = auth.uid() and role in ('owner', 'caregiver')
    )
  );

create policy report_summaries_update on public.report_summaries
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
