-- Setup-checklist accessories (PRD §5.1–5.3): awareness-only supplies a
-- prescription or label REFERENCES (a child's inhaler spacer + face mask, an
-- oral syringe, swabs, a sharps bin…). They carry no spec and never block — this
-- records only the FACT they were mentioned plus whether the user has
-- acknowledged having them. Data-bearing requirements (label, prescription,
-- diluent, syringe) are NOT stored here; they're computed from existing columns.
-- Forward-only: one nullable ADD COLUMN with a default.

alter table public.medications
  add column if not exists accessories jsonb not null default '[]'::jsonb;
  -- [{ type, label, source: 'prescription'|'label'|'inferred', acknowledged }]
