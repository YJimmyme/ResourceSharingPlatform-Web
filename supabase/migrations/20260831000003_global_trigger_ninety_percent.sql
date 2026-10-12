-- 全系統安全總量「觸發點」改為 門檻 × 0.9（分工單 2-1）：
-- 原本募資啟動條件為「當前總庫存 < 門檻 − 安全庫存量」，改為「當前總庫存 < 門檻 × 0.9」。
-- 影響 global_low_stock_view（總量不足清單/卡片）與 dashboard_summary（首頁卡片數字）。

create or replace view global_low_stock_view as
select
    definition.id as inventory_item_definition_id,
    definition.category,
    definition.item_name,
    definition.unit,
    variant.global_safety_stock,
    coalesce(totals.total_quantity, 0) as total_quantity,
    variant.id as inventory_item_variant_id,
    variant.specification,
    variant.global_threshold
from inventory_item_variant variant
join inventory_item_definition definition
    on definition.id = variant.inventory_item_definition_id
left join (
    select resolved_variant_id, sum(quantity) as total_quantity
    from supply_item_resolved
    where resolved_variant_id is not null
    group by resolved_variant_id
) totals on totals.resolved_variant_id = variant.id
where definition.is_active
  and variant.is_active
  and variant.global_threshold > 0
  and coalesce(totals.total_quantity, 0) < variant.global_threshold * 0.9;

alter view global_low_stock_view set (security_invoker = true);

comment on view global_low_stock_view is
    '全系統安全總量警示：各據點同規格庫存加總後，當「當前總庫存 < 門檻 × 0.9」時列出；異常應啟動募資。';

-- dashboard_summary：只改 global_low_total 的公式（其餘與 20260831000001 相同）。
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
        where expiration_date >= current_date and expiration_date <= current_date + 30
    ) as expiring_total,
    (select count(*) from resolved where expiration_date < current_date) as expired_total,
    (select count(*) from inventory_item_variant v
        join inventory_item_definition d on d.id = v.inventory_item_definition_id
        left join gvar g on g.variant_id = v.id
        where d.is_active and v.is_active and v.global_threshold > 0
          and coalesce(g.tq, 0) < v.global_threshold * 0.9
    ) as global_low_total;

grant select on dashboard_summary to authenticated, service_role;
