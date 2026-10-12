-- 捐贈來源整併：把「物資捐贈」(supply_donation_log) 與「物資入庫的捐贈人」
-- (supply_stock_in_log) 統一成單一讀取來源 donation_source_view，
-- 捐贈紀錄、捐贈人排行、捐贈分析全部改讀它，資料流一致、方便管理。
--
-- 兩張底表維持不動（各自的寫入路徑不變）：
--   supply_donation_log：物資捐贈頁對既有批次加碼（姓名／電話）。
--   supply_stock_in_log：物資入庫的來源紀錄（完整捐贈人：姓名／電話／地址／鄉鎮／身分別）。
-- 捐贈頁沒有的欄位在 view 內以 NULL 補齊，形狀一致。

create or replace view donation_source_view as
select
    'donation'::text as source_type,
    d.id,
    d.supply_item_id,
    d.location_id,
    d.donor_name,
    coalesce(d.donor_contact, '') as donor_contact,
    null::text as donor_address,
    null::text as donor_precinct,
    null::text as donor_district,
    null::text as donor_identity,
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
comment on view donation_source_view is
    '捐贈來源統一檢視：物資捐贈 + 物資入庫(有捐贈人)的聯集，供捐贈紀錄／排行／分析共用。';

-- 捐贈人排行改為對整併後的來源彙總（欄位維持不變，故可 CREATE OR REPLACE）。
create or replace view donor_leaderboard_view as
select
    donor_name,
    donor_contact,
    count(*) as pickup_count,
    count(distinct supply_item_id) as distinct_item_count,
    min(source_time) as first_donation_date,
    max(source_time) as last_donation_date
from donation_source_view
group by donor_name, donor_contact;

alter view donor_leaderboard_view set (security_invoker = true);
comment on view donor_leaderboard_view is
    '捐贈人排行：涵蓋物資捐贈與物資入庫的捐贈來源（讀 donation_source_view）。';
