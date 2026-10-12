-- 戰情總覽全域可見（分工單 #2/#3）：
-- 之前戰情總覽的低庫存/即期/各據點統計都來自 security_invoker=true 的 view 或
-- 直接查 supply_item，會套用「非總管只能看自己據點」的 RLS，導致幫主/小幫手
-- 看到的各據點狀態與卡片數字跟總管不一致（其他據點一律顯示正常）。
--
-- 需求（使用者確認）：戰情總覽對「全部角色」都要顯示全部據點的真實狀態。
-- 作法：新增兩支 SECURITY DEFINER（security_invoker=false）彙總 view，
-- 以擁有者身分執行、繞過底層 RLS，且**只回傳統計數字、不回傳任何明細列**，
-- 授權 authenticated 讀取。戰情總覽改讀這兩支。
--
-- 註：解析邏輯（variant/definition）與低庫存門檻直接對 base table 內聯計算，
-- 不經 security_invoker=true 的 supply_item_resolved / location_low_stock_view，
-- 以確保 RLS 確實被繞過、各角色看到相同全域結果。

-- ── 各據點彙總（每據點一列，僅統計數字）─────────────────────────
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
    count(r.id) filter (where r.expiration_date >= current_date and r.expiration_date <= current_date + 30) as expiring_soon_count,
    count(r.id) filter (where r.expiration_date < current_date) as expired_count
from supply_location l
left join resolved r on r.location_id = l.id
left join low_pairs lp on lp.location_id = r.location_id and lp.inventory_item_definition_id = r.def_id
group by l.id, l.location_name, l.is_active
order by l.id;

comment on view dashboard_location_status is
    '戰情總覽各據點彙總（全域、僅統計數字）；SECURITY DEFINER 繞過 RLS，全角色看到一致結果。';

-- ── 全域卡片數字（單列四個統計）──────────────────────────────
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
          and coalesce(g.tq, 0) < v.global_threshold - v.global_safety_stock
    ) as global_low_total;

comment on view dashboard_summary is
    '戰情總覽四個卡片數字（全域、僅統計數字）；SECURITY DEFINER 繞過 RLS，全角色一致。';

grant select on dashboard_location_status to authenticated, service_role;
grant select on dashboard_summary to authenticated, service_role;
