-- Diary template library (PRD §5.9.1): an optional patient sex, used ONLY to
-- order and filter which diary templates are visible (a male patient doesn't
-- see the menopause template unless he browses for it). It never auto-selects
-- anything and is keyed to the patient, not the account holder — a son managing
-- his mother's care sees her templates by her demographics. Forward-only,
-- nullable; the owner-update RLS policy already governs writes.

alter table public.patients
  add column sex text check (sex in ('male', 'female'));
