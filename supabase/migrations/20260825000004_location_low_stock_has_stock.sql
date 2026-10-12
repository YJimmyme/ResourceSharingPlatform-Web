-- 據點低庫存規則調整：只有「現有總量 > 0 且 ≤ 據點門檻」才算低庫存。
-- 完全沒貨(0)的品項／空據點不再列為低庫存 —— 對應使用者「有貨但碰到安全線才算」。
-- （全系統總量不足 global_low_stock_view 不變：0 反而是最該募資的情況。）
--
-- 只多一個 total_quantity > 0 條件，欄位與型別完全不變，可安全 CREATE OR REPLACE。
create or replace view location_low_stock_view as
select
    lss.location_id,
    lss.inventory_item_definition_id,
    def.category,
    def.item_name,
    def.unit,
    lss.safety_stock,
    coalesce(totals.total_quantity, 0) as total_quantity
from location_inventory_safety_stock lss
join inventory_item_definition def on def.id = lss.inventory_item_definition_id
left join (
    select location_id, resolved_definition_id, sum(quantity) as total_quantity
    from supply_item_resolved
    group by location_id, resolved_definition_id
) totals
    on totals.location_id = lss.location_id
    and totals.resolved_definition_id = lss.inventory_item_definition_id
where lss.safety_stock > 0
  and coalesce(totals.total_quantity, 0) > 0
  and coalesce(totals.total_quantity, 0) <= lss.safety_stock;

alter view location_low_stock_view set (security_invoker = true);

comment on view location_low_stock_view is
    '據點層級安全庫存警示：只算門檻 > 0、且現有總量介於 1 ~ 門檻之間（有貨但碰到安全線）；完全沒貨不列入。';
