-- Inventory quantity tracking (notifications phase; PRD §2.2 permits factual
-- run-out calculations). `quantity` is the owner-entered count on hand —
-- nullable means "not tracked", so existing rows keep working with no backfill.
-- `quantity_set_at` anchors the usage-rate window and buckets the low-supply
-- notification dedupe key: a recount opens a fresh bucket. Forward-only.
set search_path = public;

alter table public.inventory_items
  add column quantity numeric check (quantity is null or quantity >= 0),
  add column quantity_set_at timestamptz;

-- Owners adjust the count through the existing owner-only UPDATE policy, but
-- consumption happens when a dose is logged — and caregivers log doses
-- (write model §5.6). Same shape as log_single_use_dose: SECURITY DEFINER
-- with an explicit owner/caregiver gate, so the dose-log path can decrement
-- without widening the owner-only RLS on inventory_items.
create or replace function public.consume_inventory_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select pm.role into v_role
    from public.inventory_items i
    join public.patient_memberships pm
      on pm.patient_id = i.patient_id and pm.user_id = auth.uid()
    where i.id = p_item_id;
  if v_role is null or v_role = 'viewer' then
    raise exception 'not authorized to log for this patient';
  end if;

  -- No-op when the count isn't tracked; never goes below zero.
  update public.inventory_items
    set quantity = greatest(quantity - 1, 0)
    where id = p_item_id and quantity is not null;
end;
$$;

-- Inverse for dose-log undo. Best-effort symmetry: restoring past the original
-- count is possible if the owner recounted in between; the owner can recount.
create or replace function public.restore_inventory_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select pm.role into v_role
    from public.inventory_items i
    join public.patient_memberships pm
      on pm.patient_id = i.patient_id and pm.user_id = auth.uid()
    where i.id = p_item_id;
  if v_role is null or v_role = 'viewer' then
    raise exception 'not authorized to log for this patient';
  end if;

  update public.inventory_items
    set quantity = quantity + 1
    where id = p_item_id and quantity is not null;
end;
$$;

revoke all on function public.consume_inventory_item(uuid) from public;
grant execute on function public.consume_inventory_item(uuid) to authenticated;
revoke all on function public.restore_inventory_item(uuid) from public;
grant execute on function public.restore_inventory_item(uuid) to authenticated;
