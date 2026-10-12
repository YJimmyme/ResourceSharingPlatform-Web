-- ============================================================
-- 依「切點日期」清空測試資料（上線前把 9/9 之前的營運資料刪空）。
-- ⚠️ 不可逆！執行前務必：1) 先跑週備份或 db dump  2) 先跑 PART 1 看筆數
--    3) 確認無誤後，才把 PART 2 最後的 rollback 改成 commit。
--
-- 會刪除（營運/測試資料，含時間欄位）：入庫來源、領用、捐贈、報廢、轉移、
--   盤點調整、缺料/報廢申請、AI 辨識(待確認+紀錄)、稽核 Log、物資批次。
-- 會保留（非測試資料，不動）：帳號 profiles/auth、據點 supply_location、
--   目錄 inventory_item_definition/variant、據點安全庫存門檻、同義詞、
--   LINE/AI 設定、notification_state、line_bindings。
--
-- 切點：以下都用 2026-09-09 00:00（台灣 +08）＝「刪 9/9 之前」。要改日期就整批換掉。
-- ============================================================

-- ============ PART 1：預覽（唯讀，先跑這段確認會刪幾筆）============
with c as (select timestamptz '2026-09-09 00:00:00+08' as ts)
select 'supply_outbound_log'   as table_name, count(*) from supply_outbound_log,   c where outbound_time < ts
union all select 'supply_stock_in_log',   count(*) from supply_stock_in_log,   c where stock_in_time  < ts
union all select 'supply_donation_log',   count(*) from supply_donation_log,   c where donation_time  < ts
union all select 'supply_disposal_log',   count(*) from supply_disposal_log,   c where disposal_time  < ts
union all select 'supply_transfer_log',   count(*) from supply_transfer_log,   c where transfer_time  < ts
union all select 'supply_adjustment_log', count(*) from supply_adjustment_log, c where adjusted_at    < ts
union all select 'supply_request',        count(*) from supply_request,        c where created_at     < ts
union all select 'ai_stock_in_pending',   count(*) from ai_stock_in_pending,   c where created_at     < ts
union all select 'ai_stock_in_log',       count(*) from ai_stock_in_log,       c where created_at     < ts
union all select 'activity_log',          count(*) from activity_log,          c where occurred_at    < ts
union all select 'supply_item',           count(*) from supply_item,           c where created_at     < ts
order by table_name;

-- ============ PART 2：實際刪除（已備份 + 已看過 PART 1 才執行）============
-- 整段用交易包住；預設結尾是 rollback（不會真的刪）。確認 PART 1 筆數無誤後，
-- 把最後一行的  rollback;  改成  commit;  再整段執行一次，才會真的刪除。
begin;

-- 先刪「參照 supply_item 的子表」（滿足外鍵順序）
delete from supply_outbound_log   where outbound_time < '2026-09-09 00:00:00+08';
delete from supply_stock_in_log   where stock_in_time  < '2026-09-09 00:00:00+08';
delete from supply_donation_log   where donation_time  < '2026-09-09 00:00:00+08';
delete from supply_disposal_log   where disposal_time  < '2026-09-09 00:00:00+08';
delete from supply_transfer_log   where transfer_time  < '2026-09-09 00:00:00+08';
delete from supply_adjustment_log where adjusted_at    < '2026-09-09 00:00:00+08';
delete from supply_request        where created_at     < '2026-09-09 00:00:00+08';
delete from ai_stock_in_pending   where created_at     < '2026-09-09 00:00:00+08';
delete from ai_stock_in_log       where created_at     < '2026-09-09 00:00:00+08';
delete from activity_log          where occurred_at    < '2026-09-09 00:00:00+08';

-- 最後刪 supply_item：只刪「切點前」且已無任何紀錄參照的批次
-- （避免刪到仍被 9/9 之後紀錄引用的批次而觸發外鍵錯誤）
delete from supply_item si
where si.created_at < '2026-09-09 00:00:00+08'
  and not exists (select 1 from supply_outbound_log   x where x.supply_item_id = si.id)
  and not exists (select 1 from supply_stock_in_log   x where x.supply_item_id = si.id)
  and not exists (select 1 from supply_donation_log   x where x.supply_item_id = si.id)
  and not exists (select 1 from supply_disposal_log   x where x.supply_item_id = si.id)
  and not exists (select 1 from supply_transfer_log   x where x.supply_item_id = si.id)
  and not exists (select 1 from supply_adjustment_log x where x.supply_item_id = si.id)
  and not exists (select 1 from ai_stock_in_log       x where x.confirmed_supply_item_id = si.id);

-- ⬇⬇⬇ 確認無誤後，把這行的 rollback 改成 commit ⬇⬇⬇
rollback;
