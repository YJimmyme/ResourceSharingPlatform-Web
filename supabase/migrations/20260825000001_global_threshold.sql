-- 全系統安全總量：新增「募資門檻」欄位，並改變總量不足／啟動募資的判斷公式。
--
-- 需求：每個規格除了原本的「安全庫存量」（保留量），再多一個「門檻」。
-- 募資啟動條件（使用者確認）：
--     全據點加總的當前總庫存 < 門檻 − 安全庫存量
-- 亦即有效觸發點 = 門檻 − 安全庫存量；低於此值時戰情總覽列為「總量不足」。
--
-- Migration 為 append-only：不改前一版，另開較晚時間戳的檔案。

-- 1) 新增門檻欄位（每規格獨立；0 代表未設定、不監控）。
alter table inventory_item_variant
    add column if not exists global_threshold integer not null default 0
    check (global_threshold >= 0);

comment on column inventory_item_variant.global_threshold is
    '募資門檻；當「全據點加總的當前總庫存 < 門檻 − 安全庫存量」時列為總量不足／啟動募資。0 代表不監控。';

-- 2) 重建 global_low_stock_view：改用新公式。
--    以 global_threshold > 0 作為「有開啟監控」的開關；未設門檻者一律不列入。
--    新欄位 global_threshold 附加在既有欄位之後（CREATE OR REPLACE 不允許中段插欄）。
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
  and coalesce(totals.total_quantity, 0) < variant.global_threshold - variant.global_safety_stock;

alter view global_low_stock_view set (security_invoker = true);

comment on view global_low_stock_view is
    '全系統安全總量警示：各據點同規格庫存加總後，當「當前總庫存 < 門檻 − 安全庫存量」時列出；異常應啟動募資。';
