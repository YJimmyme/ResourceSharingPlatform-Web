-- 物資明細：庫存「調整（盤點修正）」＋只刪調整筆。
-- 調整 = 手動把某批次的目前數量修正成盤點值，並留一筆調整紀錄；
-- 刪除 = 只能刪自己新增的「調整」紀錄，並把當初的增減回算回去。
-- 出庫／報廢／轉移不在這裡刪（走各自的回庫/取消流程）。
--
-- 兩支函式做自己的權限檢查（只有總管理人員 is_admin），因此可直接授權給
-- authenticated 由前端 supabase.rpc 呼叫，不需另外部署 Edge Function。

create table if not exists supply_adjustment_log (
    id integer generated always as identity primary key,
    supply_item_id integer not null references supply_item(id),
    location_id integer not null references supply_location(id),
    quantity_before integer not null,
    quantity_after integer not null check (quantity_after >= 0),
    delta integer not null,
    reason text,
    operator text,
    adjusted_at timestamptz not null default now()
);
create index if not exists ix_supply_adjustment_log_supply_item_id on supply_adjustment_log(supply_item_id);

alter table supply_adjustment_log enable row level security;
drop policy if exists "supply_adjustment_log_select" on supply_adjustment_log;
create policy "supply_adjustment_log_select" on supply_adjustment_log
    for select to authenticated
    using (is_admin() or location_id = my_location_id());

comment on table supply_adjustment_log is '庫存盤點修正紀錄；寫入/刪除只透過 stock_adjust / stock_adjust_delete（總管專用）。';

-- 調整：把某批次目前數量修正成盤點值，並留一筆調整紀錄。
create or replace function stock_adjust(
    p_supply_item_id integer,
    p_new_quantity integer,
    p_reason text
) returns supply_adjustment_log
language plpgsql
security definer
set search_path = public
as $$
declare
    v_item supply_item;
    v_log supply_adjustment_log;
    v_op text;
begin
    if not is_admin() then
        raise exception '只有總管理人員可以調整庫存';
    end if;
    if p_new_quantity is null or p_new_quantity < 0 then
        raise exception '調整後數量必須是 0 或正整數';
    end if;

    select * into v_item from supply_item where id = p_supply_item_id for update;
    if not found then
        raise exception '找不到這筆物資';
    end if;

    select coalesce(display_name, username) into v_op from profiles where id = auth.uid();

    update supply_item
    set quantity = p_new_quantity,
        is_active = case when p_new_quantity > 0 then true else is_active end,
        updated_at = now()
    where id = v_item.id;

    insert into supply_adjustment_log
        (supply_item_id, location_id, quantity_before, quantity_after, delta, reason, operator)
    values
        (v_item.id, v_item.location_id, v_item.quantity, p_new_quantity, p_new_quantity - v_item.quantity,
         nullif(btrim(coalesce(p_reason, '')), ''), v_op)
    returning * into v_log;

    return v_log;
end;
$$;

-- 刪除：只刪一筆調整紀錄，並把當初的增減回算回去。
create or replace function stock_adjust_delete(p_log_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_log supply_adjustment_log;
begin
    if not is_admin() then
        raise exception '只有總管理人員可以刪除調整紀錄';
    end if;

    select * into v_log from supply_adjustment_log where id = p_log_id for update;
    if not found then
        raise exception '找不到這筆調整紀錄';
    end if;

    -- 回算：把當初調整的增減量抵銷掉。
    update supply_item
    set quantity = greatest(0, quantity - v_log.delta),
        updated_at = now()
    where id = v_log.supply_item_id;

    delete from supply_adjustment_log where id = v_log.id;
end;
$$;

revoke execute on function stock_adjust(integer, integer, text) from public, anon;
grant execute on function stock_adjust(integer, integer, text) to authenticated;
revoke execute on function stock_adjust_delete(integer) from public, anon;
grant execute on function stock_adjust_delete(integer) to authenticated;
