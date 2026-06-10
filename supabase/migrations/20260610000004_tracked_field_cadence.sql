-- Diary template library (PRD §5.9.1): a daily-vs-periodic flag on tracked
-- fields. Periodic fields (labs, body measurements) are logged "when you have a
-- result" and stay out of the daily entry form, so empty lab inputs never
-- clutter it. Forward-only; existing fields default to 'daily' (current
-- behaviour unchanged). RLS unchanged.

alter table public.tracked_fields
  add column cadence text not null default 'daily'
    check (cadence in ('daily', 'periodic'));
