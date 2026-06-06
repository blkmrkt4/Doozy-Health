-- Doozy Health — widen the medication identity palette (PRD §9). The first
-- palette had several near-identical blues/teals; this re-backfills every
-- medication with the new, well-separated palette (mirrors MED_PALETTE in
-- lib/colours.ts). Forward-only; recolours only — no data loss.
set search_path = public;

with ordered as (
  select id,
         (row_number() over (partition by patient_id order by created_at, id) - 1) as n
  from public.medications
),
palette(hex, idx) as (
  select * from unnest(array[
    '#4F9DFF','#E0B341','#E255B0','#22C3E6','#8B5CF6','#C98A5A','#FF7AA2','#3FC7B0'
  ]) with ordinality
)
update public.medications m
set colour = p.hex
from ordered o
join palette p on p.idx = (o.n % 8) + 1
where m.id = o.id;
