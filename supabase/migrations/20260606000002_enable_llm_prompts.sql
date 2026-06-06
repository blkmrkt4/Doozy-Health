-- Ship the LLM prompts enabled by default (PRD §14).
--
-- The admin-backend prompts were originally seeded `disabled` (to be switched on
-- in /admin after deploy), but their bodies are real and tuned, so a fresh
-- deploy should have extraction / normalisation / interaction / diary prompts
-- working out of the box rather than silently falling back to manual entry.
-- Forward-only and idempotent — only flips rows that are still disabled.
-- (extract_syringe already ships active via its own seed migration.)
update public.prompts
set status = 'active'
where slug in (
  'extract_prescription',
  'extract_vial',
  'normalise_drug_name',
  'explain_interaction',
  'suggest_diary_fields',
  'classify_dose_event',
  'summarise_diary_freetext'
)
and status <> 'active';
