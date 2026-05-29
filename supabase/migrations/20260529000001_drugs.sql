-- Doozy Health — reference drug database (build sequence §13.3).
-- Curated `drugs` + `drug_interactions` (PRD §5.7, §5.8, §8). Global reference
-- data: readable by any authenticated user, NOT patient-scoped. Writes happen
-- only through the service-role sync (lib/drug-sync.ts) — no client RLS write
-- policy. Identity fields (rxnorm_id, canonical_name, atc_class) are sourced
-- from RxNorm; pharmacokinetic fields are curated (RxNorm carries none) and
-- are the ground truth the PK engine (step 11) reads.
--
-- INTERACTIONS ARE CURATED GROUND TRUTH (PRD §5.8): the LLM never enumerates
-- them; explain_interaction (step 14) only renders a record we already hold.
--
-- Forward-only migration. Do not edit once applied.

set search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- drugs — one row per canonical drug. PK params are jsonb keyed by route, so a
-- drug can model different kinetics per route (e.g. oral vs transdermal).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.drugs (
  id uuid primary key default gen_random_uuid(),
  rxnorm_id text,                       -- RxCUI from RxNorm; null if unmatched
  canonical_name text not null check (length(trim(canonical_name)) > 0),
  atc_class text,
  half_life_hours jsonb not null default '{}'::jsonb,   -- { route: hours }
  bioavailability jsonb not null default '{}'::jsonb,   -- { route: 0..1 }
  tmax_hours jsonb not null default '{}'::jsonb,        -- { route: hours }
  controlled_schedule text,             -- e.g. 'CII', 'CIII'; null if none
  reference_data jsonb not null default '{}'::jsonb,    -- sources / notes
  last_synced_at timestamptz not null default now(),
  -- Canonical name is the stable upsert key for the sync (rxnorm_id can be
  -- null when a lookup misses). A column unique constraint (not a lower()
  -- expression index) so the service-role upsert can target it via onConflict.
  constraint drugs_canonical_name_uniq unique (canonical_name)
);

create index drugs_rxnorm_idx
  on public.drugs (rxnorm_id)
  where rxnorm_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- drug_interactions — curated pairwise records. Stored once per unordered pair
-- (the sync orders the pair deterministically before upsert).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.drug_interactions (
  id uuid primary key default gen_random_uuid(),
  drug_a_id uuid not null references public.drugs(id) on delete cascade,
  drug_b_id uuid not null references public.drugs(id) on delete cascade,
  severity text not null check (severity in ('info','caution','serious')),
  mechanism text not null,
  reference_source text not null,       -- e.g. 'curated', 'DDInter', 'openFDA'
  last_synced_at timestamptz not null default now(),
  check (drug_a_id <> drug_b_id),
  unique (drug_a_id, drug_b_id)
);

create index drug_interactions_a_idx on public.drug_interactions (drug_a_id);
create index drug_interactions_b_idx on public.drug_interactions (drug_b_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — reference data is readable by every authenticated user. No client
-- write policy: population is service-role only (sync bypasses RLS).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.drugs enable row level security;
alter table public.drug_interactions enable row level security;

create policy drugs_read on public.drugs
  for select to authenticated
  using (true);

create policy drug_interactions_read on public.drug_interactions
  for select to authenticated
  using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Link medications to the reference drug (the FK deferred from step 2's
-- §13.2 "drug name free text for now"). Nullable: a free-text medication that
-- doesn't match the catalogue keeps canonical_drug_id null.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.medications
  add constraint medications_canonical_drug_fkey
  foreign key (canonical_drug_id) references public.drugs(id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Extend the manual-creation RPC to record the matched canonical drug. Replace
-- the 6-arg version from migration 0003 with a 7-arg version (drop first — the
-- added parameter changes the signature). p_canonical_drug_id defaults null so
-- a free-text entry omits it.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.create_manual_medication(uuid, text, boolean, jsonb, jsonb, jsonb);

create or replace function public.create_manual_medication(
  p_patient_id uuid,
  p_display_name text,
  p_is_private boolean,
  p_prescribed jsonb,
  p_delivery jsonb,
  p_chosen jsonb,
  p_canonical_drug_id uuid default null
)
returns uuid
language plpgsql
as $$
declare
  v_med_id uuid;
begin
  insert into public.medications
    (patient_id, canonical_drug_id, display_name, is_private, entry_source)
  values
    (p_patient_id, p_canonical_drug_id, p_display_name,
     coalesce(p_is_private, false), 'manual')
  returning id into v_med_id;

  insert into public.prescribed_regimens
    (medication_id, patient_id, dose_amount, dose_unit, frequency, route,
     duration_days, prescriber_name)
  values
    (v_med_id, p_patient_id,
     (p_prescribed->>'dose_amount')::numeric,
     p_prescribed->>'dose_unit',
     p_prescribed->'frequency',
     p_prescribed->>'route',
     nullif(p_prescribed->>'duration_days', '')::integer,
     nullif(p_prescribed->>'prescriber_name', ''));

  insert into public.delivery_forms
    (medication_id, patient_id, form_type, concentration, package_count,
     package_unit, syringe_spec, expiry_date, batch, manufacturer)
  values
    (v_med_id, p_patient_id,
     p_delivery->>'form_type',
     p_delivery->'concentration',
     nullif(p_delivery->>'package_count', '')::numeric,
     nullif(p_delivery->>'package_unit', ''),
     p_delivery->'syringe_spec',
     nullif(p_delivery->>'expiry_date', '')::date,
     nullif(p_delivery->>'batch', ''),
     nullif(p_delivery->>'manufacturer', ''));

  insert into public.chosen_regimens
    (medication_id, patient_id, dose_amount, dose_unit, frequency, route,
     reason_note, active)
  values
    (v_med_id, p_patient_id,
     (p_chosen->>'dose_amount')::numeric,
     p_chosen->>'dose_unit',
     p_chosen->'frequency',
     p_chosen->>'route',
     nullif(p_chosen->>'reason_note', ''),
     true);

  return v_med_id;
end;
$$;
