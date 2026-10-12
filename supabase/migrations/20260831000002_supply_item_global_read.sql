-- 戰情總覽清單也全域可見（分工單 #2/#3 後續，使用者確認「清單也改全域」）：
-- 之前 supply_item 的 SELECT RLS 限「總管或自己據點」，導致戰情總覽點卡片進去的
-- 狀態清單（低庫存/即期/已過期）以及「舉手」時挑「哪個據點有貨」的來源下拉，
-- 對幫主/小幫手都只看得到自己據點 —— 與已改為全域的卡片數字不一致。
--
-- 調整：SELECT 放寬為「所有登入者可讀全部據點的物資」（庫存量非機敏資料，且戰情
-- 總覽本就是全域態勢頁）。**寫入權限不變**：新增/修改/刪除仍限總管或所屬據點，
-- 資料完整性不受影響（且所有扣庫存交易本就走 Edge Function 服務端把關）。

drop policy if exists "supply_item_select" on supply_item;
create policy "supply_item_select" on supply_item
    for select to authenticated
    using (true);

-- 寫入政策維持原樣（此處僅重申，內容與 20260812000003 相同，冪等）。
drop policy if exists "supply_item_write" on supply_item;
create policy "supply_item_write" on supply_item
    for all to authenticated
    using (is_admin() or location_id = my_location_id())
    with check (is_admin() or location_id = my_location_id());
