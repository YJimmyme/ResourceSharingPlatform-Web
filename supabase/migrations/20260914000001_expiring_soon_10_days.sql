-- 即將過期天數由 30 天改為 10 天。
-- 前端(StatusList/SupplyItems/MobileFeatures/stockBatch)已改用 EXPIRY_WARNING_DAYS=10；
-- 戰情總覽卡片與各據點統計來自 dashboard_summary / dashboard_location_status 兩支
-- SECURITY DEFINER view，這裡把其中的 current_date + 30 改為 current_date + 10。
-- 其餘邏輯（低庫存門檻、募資 門檻×0.9、過期）不變。

create or replace view dashboard_location_status
with (security_invoker = false) as
with resolved as (
    select
        si.id, si.location_id, si.quantity, si.expiration_date,
        coalesce(v_def.id, name_def.id) as def_id
    from supply_item si
    left join inventory_item_variant v on v.id = si.inventory_item_variant_id
    left join inventory_item_definition v_def on v_def.id = v.inventory_item_definition_id
    left join inventory_item_definition name_def
        on name_def.category = si.category and name_def.item_name = si.item_name
        and name_def.is_active and v_def.id is null
    where si.is_active
),
totals_def as (
    select location_id, def_id, sum(quantity) as tq
    from resolved group by location_id, def_id
),
low_pairs as (
    select lss.location_id, lss.inventory_item_definition_id
    from location_inventory_safety_stock lss
    join totals_def t
        on t.location_id = lss.location_id and t.def_id = lss.inventory_item_definition_id
    where lss.safety_stock > 0 and t.tq > 0 and t.tq <= lss.safety_stock
)
select
    l.id as location_id,
    l.location_name,
    l.is_active,
    count(distinct r.def_id) filter (where r.def_id is not null) as item_type_count,
    coalesce(sum(r.quantity), 0) as total_quantity,
    count(r.id) filter (where lp.location_id is not null) as low_stock_count,
    count(r.id) filter (where r.expiration_date >= current_date and r.expiration_date <= current_date + 10) as expiring_soon_count,
    count(r.id) filter (where r.expiration_date < current_date) as expired_count
from supply_location l
left join resolved r on r.location_id = l.id
left join low_pairs lp on lp.location_id = r.location_id and lp.inventory_item_definition_id = r.def_id
group by l.id, l.location_name, l.is_active
order by l.id;

create or replace view dashboard_summary
with (security_invoker = false) as
with resolved as (
    select
        si.id, si.location_id, si.quantity, si.expiration_date,
        coalesce(v_def.id, name_def.id) as def_id,
        coalesce(v.id, fb.id) as variant_id
    from supply_item si
    left join inventory_item_variant v on v.id = si.inventory_item_variant_id
    left join inventory_item_definition v_def on v_def.id = v.inventory_item_definition_id
    left join inventory_item_definition name_def
        on name_def.category = si.category and name_def.item_name = si.item_name
        and name_def.is_active and v_def.id is null
    left join lateral (
        select c.id from inventory_item_variant c
        where c.inventory_item_definition_id = name_def.id and c.is_active
          and c.specification is not distinct from si.specification
        order by c.id limit 1
    ) fb on v.id is null
    where si.is_active
),
totals_def as (
    select location_id, def_id, sum(quantity) as tq
    from resolved group by location_id, def_id
),
low_pairs as (
    select lss.location_id, lss.inventory_item_definition_id
    from location_inventory_safety_stock lss
    join totals_def t
        on t.location_id = lss.location_id and t.def_id = lss.inventory_item_definition_id
    where lss.safety_stock > 0 and t.tq > 0 and t.tq <= lss.safety_stock
),
gvar as (
    select variant_id, sum(quantity) as tq
    from resolved where variant_id is not null group by variant_id
)
select
    (select count(r.id) from resolved r
        join low_pairs lp on lp.location_id = r.location_id and lp.inventory_item_definition_id = r.def_id
    ) as low_stock_total,
    (select count(*) from resolved
        where expiration_date >= current_date and expiration_date <= current_date + 10
    ) as expiring_total,
    (select count(*) from resolved where expiration_date < current_date) as expired_total,
    (select count(*) from inventory_item_variant v
        join inventory_item_definition d on d.id = v.inventory_item_definition_id
        left join gvar g on g.variant_id = v.id
        where d.is_active and v.is_active and v.global_threshold > 0
          and coalesce(g.tq, 0) < v.global_threshold * 0.9
    ) as global_low_total;

grant select on dashboard_location_status to authenticated, service_role;
grant select on dashboard_summary to authenticated, service_role;
