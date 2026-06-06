-- Doozy Health — per-medication identity colour for the medication calendar.
-- Forward-only, additive. Stores a resolved hex; the curated palette and the
-- assignment logic live in lib/colours.ts (the source of truth). Red and green
-- are reserved for adherence status and never appear here, so a medication dot
-- is never confused with a warning. See PRD §9, §6.1.
set search_path = public;

alter table public.medications
  add column colour text
    check (colour is null or colour ~ '^#[0-9A-Fa-f]{6}$');

-- Backfill existing rows: deterministic round-robin over the identity palette,
-- ordered per patient so each patient's medications get distinct, stable hues.
-- The palette below mirrors MED_PALETTE in lib/colours.ts.
with ordered as (
  select id,
         (row_number() over (partition by patient_id order by created_at, id) - 1) as n
  from public.medications
  where colour is null
),
palette(hex, idx) as (
  select * from unnest(array[
    '#6AA9FF','#5FD0C5','#7FC7E3','#69C8D8','#8B9DF0','#A98CF0',
    '#C58AE0','#D98AC4','#E89BB0','#C9B07A','#CDA0E0'
  ]) with ordinality
)
update public.medications m
set colour = p.hex
from ordered o
join palette p on p.idx = (o.n % 11) + 1
where m.id = o.id;
