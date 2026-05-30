-- Doozy Health — admin backend foundation (build sequence §13.6, PRD §14).
-- Creates the LLM infrastructure tables: system_secrets, system_settings,
-- openrouter_models, prompts + prompt_versions + prompt_bindings,
-- llm_call_logs, admin_audit_log, and extraction_deltas. Seeds 7 disabled
-- prompts from PRD §14.8 and a system_settings singleton with default models.
--
-- SECURITY NOTE (PRD §14.9):
--   * system_secrets has NO RLS policies — reached only via SECURITY DEFINER
--     server actions or the service-role client. Even authenticated users with
--     the anon key cannot SELECT from it (RLS enabled, no policies = deny all).
--   * All other admin tables have RLS gated on is_current_system_admin()
--     (defined in 20260528000001_scoping_foundation.sql).
--
-- Forward-only migration. Do not edit once applied.

set search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- system_secrets — app-layer encrypted key–value store for API keys.
-- Encryption: AES-256-GCM via lib/crypto.ts, envelope = iv:tag:ciphertext (hex).
-- The DB only ever sees ciphertext + a masked preview (§6.2, §14.3).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.system_secrets (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  value_encrypted text not null,
  value_masked    text not null,
  description text not null default '',
  updated_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger system_secrets_set_updated_at
  before update on public.system_secrets
  for each row execute function public.set_updated_at();

-- RLS enabled but NO policies → deny all via anon/authenticated roles.
-- Only the service-role client or SECURITY DEFINER functions can reach this.
alter table public.system_secrets enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- system_settings — singleton config row (PRD §14.3).
-- The boolean PK trick: id is always true, so at most one row can exist.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.system_settings (
  id          boolean primary key default true check (id = true),
  default_primary_model_slug    text not null default 'anthropic/claude-opus-4',
  default_fallback_1_model_slug text not null default 'anthropic/claude-sonnet-4',
  default_fallback_2_model_slug text not null default 'openai/gpt-4o',
  updated_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger system_settings_set_updated_at
  before update on public.system_settings
  for each row execute function public.set_updated_at();

alter table public.system_settings enable row level security;

create policy system_settings_admin_select on public.system_settings
  for select to authenticated
  using (public.is_current_system_admin());

create policy system_settings_admin_update on public.system_settings
  for update to authenticated
  using (public.is_current_system_admin())
  with check (public.is_current_system_admin());

-- Seed the singleton row.
insert into public.system_settings (id) values (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- openrouter_models — cached catalogue from OpenRouter /api/v1/models.
-- Refreshed daily by syncModels(); models that disappear are marked
-- is_available = false, never deleted (PRD §14.5).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.openrouter_models (
  slug        text primary key,
  name        text not null,
  provider    text not null,
  context_length        int,
  input_cost_per_mtoken  numeric(12,4),
  output_cost_per_mtoken numeric(12,4),
  supports_vision        boolean not null default false,
  supports_tools         boolean not null default false,
  supports_json_mode     boolean not null default false,
  is_coding_specialist   boolean not null default false,
  is_reasoning_specialist boolean not null default false,
  is_available           boolean not null default true,
  last_synced_at         timestamptz not null default now(),
  raw                    jsonb
);

alter table public.openrouter_models enable row level security;

create policy openrouter_models_admin_select on public.openrouter_models
  for select to authenticated
  using (public.is_current_system_admin());

-- No client write policies — writes go through the service-role client.

-- ─────────────────────────────────────────────────────────────────────────────
-- prompts — the prompt registry. Each prompt is referenced by code via its
-- immutable slug (PRD §14.4). current_version_id points to the active
-- prompt_versions row (circular FK, deferrable).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.prompts (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique
    check (slug ~ '^[a-z][a-z0-9_]*$'),
  name       text not null,
  description text not null default '',
  purpose    text not null default 'other'
    check (purpose in ('extraction','classification','summary','other')),
  current_version_id uuid,  -- FK added after prompt_versions exists
  status     text not null default 'disabled'
    check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger prompts_set_updated_at
  before update on public.prompts
  for each row execute function public.set_updated_at();

alter table public.prompts enable row level security;

create policy prompts_admin_select on public.prompts
  for select to authenticated
  using (public.is_current_system_admin());

create policy prompts_admin_insert on public.prompts
  for insert to authenticated
  with check (public.is_current_system_admin());

create policy prompts_admin_update on public.prompts
  for update to authenticated
  using (public.is_current_system_admin())
  with check (public.is_current_system_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- prompt_versions — immutable snapshots of a prompt body. Editing a prompt
-- always creates a new version; old versions are retained (PRD §14.4.2).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.prompt_versions (
  id             uuid primary key default gen_random_uuid(),
  prompt_id      uuid not null references public.prompts(id) on delete cascade,
  version_number int  not null,
  body           text not null,
  available_slugs jsonb not null default '[]'::jsonb,
  notes          text not null default '',
  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (prompt_id, version_number)
);

alter table public.prompt_versions enable row level security;

create policy prompt_versions_admin_select on public.prompt_versions
  for select to authenticated
  using (public.is_current_system_admin());

create policy prompt_versions_admin_insert on public.prompt_versions
  for insert to authenticated
  with check (public.is_current_system_admin());

-- Now add the deferrable FK from prompts → prompt_versions.
alter table public.prompts
  add constraint prompts_current_version_fk
  foreign key (current_version_id)
  references public.prompt_versions(id)
  on delete set null
  deferrable initially deferred;

-- ─────────────────────────────────────────────────────────────────────────────
-- prompt_bindings — 1:1 with prompts. Binds a prompt to a primary model and
-- up to 2 fallbacks, plus generation parameters (PRD §14.4.2).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.prompt_bindings (
  prompt_id           uuid primary key references public.prompts(id) on delete cascade,
  primary_model_slug  text not null,
  fallback_1_model_slug text,
  fallback_2_model_slug text,
  temperature         numeric(3,2) not null default 0.20,
  max_tokens          int not null default 2048,
  response_format     text not null default 'text'
    check (response_format in ('text','json')),
  json_schema         jsonb,
  updated_by          uuid references public.users(id) on delete set null,
  updated_at          timestamptz not null default now()
);

create trigger prompt_bindings_set_updated_at
  before update on public.prompt_bindings
  for each row execute function public.set_updated_at();

alter table public.prompt_bindings enable row level security;

create policy prompt_bindings_admin_select on public.prompt_bindings
  for select to authenticated
  using (public.is_current_system_admin());

create policy prompt_bindings_admin_insert on public.prompt_bindings
  for insert to authenticated
  with check (public.is_current_system_admin());

create policy prompt_bindings_admin_update on public.prompt_bindings
  for update to authenticated
  using (public.is_current_system_admin())
  with check (public.is_current_system_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- llm_call_logs — every llmCall attempt is logged here (PRD §14.6).
-- Service-role INSERT; admin SELECT for the cost dashboard and recent-calls
-- view (§14.3).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.llm_call_logs (
  id            uuid primary key default gen_random_uuid(),
  prompt_slug   text not null,
  model_used    text not null,
  was_fallback  smallint not null default 0
    check (was_fallback in (0, 1, 2)),
  latency_ms    int not null,
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric(12,6),  -- nullable; computed in a follow-up (§14.3)
  success       boolean not null,
  error_message text,
  was_test      boolean not null default false,
  actor_id      uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index llm_call_logs_created_idx
  on public.llm_call_logs (created_at desc);
create index llm_call_logs_slug_idx
  on public.llm_call_logs (prompt_slug, created_at desc);

alter table public.llm_call_logs enable row level security;

create policy llm_call_logs_admin_select on public.llm_call_logs
  for select to authenticated
  using (public.is_current_system_admin());

-- No client INSERT — writes go through the service-role client inside llmCall.

-- ─────────────────────────────────────────────────────────────────────────────
-- admin_audit_log — every admin mutation is logged here (PRD §14.9).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.admin_audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid not null references public.users(id) on delete cascade,
  entity     text not null,
  entity_id  text not null,
  action     text not null
    check (action in ('create','update','delete','view_source')),
  diff       jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_log_actor_idx
  on public.admin_audit_log (actor_id, created_at desc);

alter table public.admin_audit_log enable row level security;

create policy admin_audit_log_admin_select on public.admin_audit_log
  for select to authenticated
  using (public.is_current_system_admin());

create policy admin_audit_log_admin_insert on public.admin_audit_log
  for insert to authenticated
  with check (public.is_current_system_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- extraction_deltas — per-field divergence between LLM extraction and user
-- confirmation (PRD §5.2.3, §14.7). Powers the Extractions admin page.
--
-- HARD RULE #10: no patient_id, no medication_id. Keeps drug_canonical_name
-- for grouping and document_id for source review. Privacy by design.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.extraction_deltas (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid references public.documents(id) on delete set null,
  drug_canonical_name text not null,
  prompt_slug        text not null,
  prompt_version_id  uuid not null references public.prompt_versions(id) on delete restrict,
  model_used         text not null,
  field_name         text not null,
  direction          text not null
    check (direction in ('llm_to_user','user_to_llm')),
  llm_value          text not null,
  user_value         text not null,
  llm_confidence     text
    check (llm_confidence is null or llm_confidence in ('high','medium','low')),
  admin_annotation   text not null default 'unreviewed'
    check (admin_annotation in ('unreviewed','expected','extraction_miss')),
  created_at         timestamptz not null default now()
);

create index extraction_deltas_drug_idx
  on public.extraction_deltas (drug_canonical_name);
create index extraction_deltas_slug_idx
  on public.extraction_deltas (prompt_slug);

alter table public.extraction_deltas enable row level security;

create policy extraction_deltas_admin_select on public.extraction_deltas
  for select to authenticated
  using (public.is_current_system_admin());

-- Admin can update the annotation field (unreviewed → expected / extraction_miss).
create policy extraction_deltas_admin_update on public.extraction_deltas
  for update to authenticated
  using (public.is_current_system_admin())
  with check (public.is_current_system_admin());

-- No client INSERT — writes go through the service-role client at extraction
-- confirmation time.

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed prompts (PRD §14.8). All ship disabled with placeholder bodies.
-- The circular FK (prompts.current_version_id → prompt_versions.id) requires
-- SET CONSTRAINTS ALL DEFERRED inside a transaction.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  pid uuid;
  vid uuid;
begin
  set constraints all deferred;

  -- 1. extract_vial
  pid := gen_random_uuid();
  vid := gen_random_uuid();
  insert into public.prompts (id, slug, name, description, purpose, current_version_id, status)
    values (pid, 'extract_vial', 'Extract vial', 'Read a vial / packaging photo into structured fields.', 'extraction', vid, 'disabled');
  insert into public.prompt_versions (id, prompt_id, version_number, body, available_slugs, notes)
    values (vid, pid, 1, 'Placeholder — write the real body in /admin/prompts before enabling.', '["known_medications","user_default_units"]'::jsonb, 'Seed version');
  insert into public.prompt_bindings (prompt_id, primary_model_slug, fallback_1_model_slug, fallback_2_model_slug)
    values (pid, 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4', 'openai/gpt-4o');

  -- 2. extract_prescription
  pid := gen_random_uuid();
  vid := gen_random_uuid();
  insert into public.prompts (id, slug, name, description, purpose, current_version_id, status)
    values (pid, 'extract_prescription', 'Extract prescription', 'Read a prescription (photo or pasted text) into structured fields.', 'extraction', vid, 'disabled');
  insert into public.prompt_versions (id, prompt_id, version_number, body, available_slugs, notes)
    values (vid, pid, 1, 'Placeholder — write the real body in /admin/prompts before enabling.', '["known_medications","prescription_text"]'::jsonb, 'Seed version');
  insert into public.prompt_bindings (prompt_id, primary_model_slug, fallback_1_model_slug, fallback_2_model_slug)
    values (pid, 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4', 'openai/gpt-4o');

  -- 3. normalise_drug_name
  pid := gen_random_uuid();
  vid := gen_random_uuid();
  insert into public.prompts (id, slug, name, description, purpose, current_version_id, status)
    values (pid, 'normalise_drug_name', 'Normalise drug name', 'Map a raw drug name to a canonical drugs record.', 'classification', vid, 'disabled');
  insert into public.prompt_versions (id, prompt_id, version_number, body, available_slugs, notes)
    values (vid, pid, 1, 'Placeholder — write the real body in /admin/prompts before enabling.', '["raw_name","known_drugs","user_locale"]'::jsonb, 'Seed version');
  insert into public.prompt_bindings (prompt_id, primary_model_slug, fallback_1_model_slug, fallback_2_model_slug)
    values (pid, 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4', 'openai/gpt-4o');

  -- 4. explain_interaction
  pid := gen_random_uuid();
  vid := gen_random_uuid();
  insert into public.prompts (id, slug, name, description, purpose, current_version_id, status)
    values (pid, 'explain_interaction', 'Explain interaction', 'Render a curated interaction record in plain English. Does not enumerate.', 'summary', vid, 'disabled');
  insert into public.prompt_versions (id, prompt_id, version_number, body, available_slugs, notes)
    values (vid, pid, 1, 'Placeholder — write the real body in /admin/prompts before enabling.', '["drug_a_name","drug_b_name","mechanism","severity","user_reading_level"]'::jsonb, 'Seed version');
  insert into public.prompt_bindings (prompt_id, primary_model_slug, fallback_1_model_slug, fallback_2_model_slug)
    values (pid, 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4', 'openai/gpt-4o');

  -- 5. suggest_diary_fields
  pid := gen_random_uuid();
  vid := gen_random_uuid();
  insert into public.prompts (id, slug, name, description, purpose, current_version_id, status)
    values (pid, 'suggest_diary_fields', 'Suggest diary fields', 'Suggest tracking fields based on the user''s medications.', 'other', vid, 'disabled');
  insert into public.prompt_versions (id, prompt_id, version_number, body, available_slugs, notes)
    values (vid, pid, 1, 'Placeholder — write the real body in /admin/prompts before enabling.', '["medication_list","user_stated_concerns"]'::jsonb, 'Seed version');
  insert into public.prompt_bindings (prompt_id, primary_model_slug, fallback_1_model_slug, fallback_2_model_slug)
    values (pid, 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4', 'openai/gpt-4o');

  -- 6. classify_dose_event
  pid := gen_random_uuid();
  vid := gen_random_uuid();
  insert into public.prompts (id, slug, name, description, purpose, current_version_id, status)
    values (pid, 'classify_dose_event', 'Classify dose event', 'Disambiguate a vague free-text log into a structured dose event.', 'classification', vid, 'disabled');
  insert into public.prompt_versions (id, prompt_id, version_number, body, available_slugs, notes)
    values (vid, pid, 1, 'Placeholder — write the real body in /admin/prompts before enabling.', '["raw_log_text","recent_schedule","recent_logs"]'::jsonb, 'Seed version');
  insert into public.prompt_bindings (prompt_id, primary_model_slug, fallback_1_model_slug, fallback_2_model_slug)
    values (pid, 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4', 'openai/gpt-4o');

  -- 7. summarise_diary_freetext
  pid := gen_random_uuid();
  vid := gen_random_uuid();
  insert into public.prompts (id, slug, name, description, purpose, current_version_id, status)
    values (pid, 'summarise_diary_freetext', 'Summarise diary freetext', 'Convert a free-text symptom note into structured tags for the doctor PDF.', 'summary', vid, 'disabled');
  insert into public.prompt_versions (id, prompt_id, version_number, body, available_slugs, notes)
    values (vid, pid, 1, 'Placeholder — write the real body in /admin/prompts before enabling.', '["note_text","patient_tracked_fields"]'::jsonb, 'Seed version');
  insert into public.prompt_bindings (prompt_id, primary_model_slug, fallback_1_model_slug, fallback_2_model_slug)
    values (pid, 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4', 'openai/gpt-4o');
end;
$$;
