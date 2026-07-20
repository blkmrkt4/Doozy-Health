-- Per-user UI preferences (first key: simple_mode). Lives on users, not
-- patients: a caregiver viewing the same patient keeps their own view, and
-- the preference follows the user across devices — unlike the localStorage
-- theme/privacy/charts toggles. Reads/writes are already scoped to the row
-- owner by users_self_select / users_self_update; no policy changes needed.

set search_path = public;

alter table public.users
  add column display_prefs jsonb not null default '{}'::jsonb;

comment on column public.users.display_prefs is
  'Per-user UI preferences, e.g. {"simple_mode": true}. Self-only via users_self_select/users_self_update.';
