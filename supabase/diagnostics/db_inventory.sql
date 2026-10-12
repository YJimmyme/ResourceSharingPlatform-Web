-- ============================================================
-- 資料庫盤點（唯讀）：只有 SELECT，不會修改任何資料或結構。
-- 用途：確認因反覆修改是否有殘留/重複物件、以及測試資料量。
-- 在 Supabase → SQL Editor 貼上執行，把各段結果貼回給我。
-- ============================================================

-- 1) 所有資料表 + 目前列數（看哪些是空的 / 哪些累積了測試資料）
select
  c.relname                                   as table_name,
  c.reltuples::bigint                         as approx_rows,   -- 統計值（快速）
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_size
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- 2) 所有 view（確認沒有重複或殘留）
select table_name as view_name
from information_schema.views
where table_schema = 'public'
order by table_name;

-- 3) 所有函式 + 參數簽章（重點：找同名但多個簽章的殘留版本）
select
  p.proname                                   as function_name,
  pg_get_function_identity_arguments(p.oid)   as arguments,
  count(*) over (partition by p.proname)       as versions_of_this_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname, arguments;

-- 4) 幾張「可能已淘汰」的表實際還有多少資料
select 'supply_donation_log'  as tbl, count(*) as rows from supply_donation_log
union all select 'supply_stock_in_log', count(*) from supply_stock_in_log
union all select 'supply_request',      count(*) from supply_request
union all select 'ai_stock_in_pending', count(*) from ai_stock_in_pending
union all select 'notification_state',  count(*) from notification_state
union all select 'line_bindings',       count(*) from line_bindings
union all select 'line_bind_codes',     count(*) from line_bind_codes;

-- 5) 據點清單（找測試用/停用據點；整理測試資料會用到 location_id）
select id, location_name, is_active
from supply_location
order by id;

-- 6) 各據點的庫存批次數量（看哪個據點像是測試堆出來的）
select
  l.id, l.location_name, l.is_active,
  count(si.id)               as item_batches,
  coalesce(sum(si.quantity),0) as total_qty
from supply_location l
left join supply_item si on si.location_id = l.id
group by l.id, l.location_name, l.is_active
order by l.id;

-- 7) 沒掛規格（inventory_item_variant_id 為 null）的庫存批次 —— 入庫時選「無」的待補分類量
select count(*) as items_without_variant
from supply_item
where inventory_item_variant_id is null;

-- 8) 指向「已停用據點」的庫存批次（若有，代表停用據點仍留著庫存資料）
select si.id, si.item_name, si.quantity, si.location_id, l.location_name
from supply_item si
join supply_location l on l.id = si.location_id
where l.is_active = false
order by si.location_id, si.id;
