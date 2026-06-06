-- Doozy Health — re-backfill medication identity colours with the vivid "RIZE"
-- palette (PRD §9). The previous palette read as too muted (gold especially).
-- Forward-only; recolours only — no data loss. Mirrors MED_PALETTE in
-- lib/colours.ts.
set search_path = public;

with ordered as (
  select id,
         (row_number() over (partition by patient_id order by created_at, id) - 1) as n
  from public.medications
),
palette(hex, idx) as (
  select * from unnest(array[
    '#3AAFFF','#FF32FF','#B400FF','#32FFFF','#FF5F3A','#B4FF00','#6BBF8A'
  ]) with ordinality
)
update public.medications m
set colour = p.hex
from ordered o
join palette p on p.idx = (o.n % 7) + 1
where m.id = o.id;
