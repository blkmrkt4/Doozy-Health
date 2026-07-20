-- "Questions noted for this visit" (PRD §5.10): user-authored free text that
-- prints on the snapshot's essentials page. Stored beside the cached summary
-- row for the same (patient, range) key but written independently of the LLM
-- call — saving a note never re-bills the model and is excluded from
-- facts_hash. Rendered verbatim and clearly attributed to the user.

set search_path = public;

alter table public.report_summaries
  add column visit_notes text;

comment on column public.report_summaries.visit_notes is
  'User-authored questions/notes for the appointment; verbatim, never LLM text.';
