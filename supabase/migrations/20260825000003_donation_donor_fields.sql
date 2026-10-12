-- 物資捐贈也補齊捐贈人完整欄位（地址／鄉鎮／身分別），與入庫來源一致。
-- 影響：supply_donation_log 加欄、donation_create() 加參數、donation_source_view
--       改為讀捐贈的真實欄位（不再一律 NULL）。
-- ⚠️ 搭配 Edge Function donation-create 需一併重新部署（會多傳這幾個欄位）。

-- 1) 加欄位（皆可空，既有資料不受影響）。
alter table supply_donation_log
    add column if not exists donor_address text,
    add column if not exists donor_precinct text,
    add column if not exists donor_district text,
    add column if not exists donor_identity text
        check (donor_identity in ('LowIncome', 'MidLowIncome', 'General', 'Other') or donor_identity is null);

-- 2) donation_create()：新增四個捐贈人欄位參數並寫入。
-- 舊的 7 參數版本先移除，改成 11 參數版（新欄位給預設值，呼叫端未傳也安全）。
drop function if exists donation_create(integer, integer, integer, text, text, text, text);

create or replace function donation_create(
    p_supply_item_id integer,
    p_location_id integer,
    p_donation_quantity integer,
    p_donor_name text,
    p_donor_contact text,
    p_operator text,
    p_remark text,
    p_donor_address text default null,
    p_donor_precinct text default null,
    p_donor_district text default null,
    p_donor_identity text default null
) returns supply_donation_log
language plpgsql
security definer
set search_path = public
as $$
declare
    v_item supply_item;
    v_log supply_donation_log;
begin
    if p_donation_quantity <= 0 then
        raise exception '捐贈數量必須大於 0';
    end if;

    select * into v_item from supply_item
    where id = p_supply_item_id and location_id = p_location_id and is_active
    for update;

    if not found then
        raise exception '找不到指定據點的這項物資';
    end if;

    update supply_item set quantity = quantity + p_donation_quantity, updated_at = now()
    where id = v_item.id;

    insert into supply_donation_log
        (supply_item_id, location_id, donation_quantity, donor_name, donor_contact, "operator", remark,
         donor_address, donor_precinct, donor_district, donor_identity)
    values
        (v_item.id, v_item.location_id, p_donation_quantity, p_donor_name, p_donor_contact, p_operator, p_remark,
         p_donor_address, p_donor_precinct, p_donor_district, p_donor_identity)
    returning * into v_log;

    return v_log;
end;
$$;

revoke execute on function donation_create(integer, integer, integer, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function donation_create(integer, integer, integer, text, text, text, text, text, text, text, text) to service_role;

-- 3) donation_source_view：捐贈列改讀真實欄位（原本一律 NULL）。
create or replace view donation_source_view as
select
    'donation'::text as source_type,
    d.id,
    d.supply_item_id,
    d.location_id,
    d.donor_name,
    coalesce(d.donor_contact, '') as donor_contact,
    d.donor_address,
    d.donor_precinct,
    d.donor_district,
    d.donor_identity,
    d.donation_quantity as quantity,
    d.donation_time as source_time,
    d.operator,
    d.remark
from supply_donation_log d
where coalesce(btrim(d.donor_name), '') <> ''
union all
select
    'stock_in'::text as source_type,
    s.id,
    s.supply_item_id,
    s.location_id,
    s.donor_name,
    coalesce(s.donor_contact, '') as donor_contact,
    s.donor_address,
    s.donor_precinct,
    s.donor_district,
    s.donor_identity,
    s.stock_in_quantity as quantity,
    s.stock_in_time as source_time,
    s.operator,
    s.remark
from supply_stock_in_log s
where coalesce(btrim(s.donor_name), '') <> '';

alter view donation_source_view set (security_invoker = true);
