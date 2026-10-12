-- 讓每一筆物資批次都記得「誰建立、誰最後修改」，補上 supply_item 缺少的操作人資訊。
-- （出庫/領用、捐贈、報廢、轉移、調整、入庫來源等紀錄表本來就有 operator。）
-- 用途之一：測試帳號的資料事後可依 created_by 精準辨識與清除，不影響正式資料。

alter table supply_item
    add column if not exists created_by text,
    add column if not exists updated_by text;

comment on column supply_item.created_by is '建立此批次的操作人（display_name／username）；入庫時寫入。';
comment on column supply_item.updated_by is '最後修改此批次的操作人；物資清單編輯時寫入。';
