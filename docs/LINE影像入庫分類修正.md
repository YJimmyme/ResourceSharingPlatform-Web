# LINE 影像入庫分類修正（2026-10-13）

## 原因

LINE 的 MobileVision 呼叫 `ai-stockin-recognize`。它已讀取 `inventory_item_definition`（與網頁「庫存種類設定」相同的表）及 `catalog_synonym`，但原本分類邏輯優先採用 AI 的六種固定分類。因此 AI 將糖果歸為食品時，目錄中的零食類被忽略。

`ai-stockin-confirm` 原本直接將前端 category 傳入入庫 RPC；庫存頁讀取 `supply_item.category` 顯示，不會另外依目錄改分類。因此錯誤會被寫進庫存並持續顯示。

## 修正後流程

照片 → AI 辨識名稱 → 同義詞轉標準品名 → 查啟用品項目錄 → 以目錄分類建立待確認紀錄 → LINE 顯示物資種類 → 確認時再次讀最新目錄、依目前品名核對分類 → 入庫 → 網頁顯示存入的分類。

- 糖果：零食類；糖：調味料類；砂糖：食品，各自精確匹配，不做名稱包含比對。
- 找不到目錄時保留暫定分類，仍需人工核對。
- 查詢目錄失敗時停止操作，不默默沿用 AI 分類。
- 同名存在多個相異分類時停止操作，要求釐清目錄。
- 修改 LINE 核對頁品名後，分類提示改成「確認入庫時依名稱核對庫存種類設定」，避免顯示舊品名的分類。
- 此次只修正物資種類 category；有效期／冷凍等 stock_type、數量與單位邏輯沒有改動。

## 修改檔案

- `supabase/functions/_shared/stockin-category.ts`：共用目錄分類規則。
- `supabase/functions/ai-stockin-recognize/index.ts`：目錄分類優先，提示詞包含目錄分類，檢查目錄查詢錯誤。
- `supabase/functions/ai-stockin-confirm/index.ts`：正式寫入前重新核對最新分類。
- `src/pages/MobileFeatures.tsx`：LINE 核對畫面顯示分類。
- `tests/stockin-category.test.mjs`：執行實際 Edge handler，以假資料庫／AI 回應驗證。

## 驗證

執行 `node --test tests/stockin-category.test.mjs`：7 項通過，沒有呼叫真實 AI 或寫入庫存。`npm run build` 通過；lint 無錯誤，仍有其他既有頁面的 4 項警告。

## 上線

本次完成的是本機程式修正，尚未發布 GitHub、部署 Supabase 或改動正式資料庫。

在專案根目錄登入正確 Supabase 帳號，將下列 PROJECT_REF 替換成 LINE 網站實際使用的 Supabase 專案：

```sh
npx supabase functions deploy ai-stockin-recognize --project-ref PROJECT_REF
npx supabase functions deploy ai-stockin-confirm --project-ref PROJECT_REF
```

共用 `_shared` 檔案會隨引用的函式打包。兩個函式都要部署，僅更新 GitHub Pages 前端無法修正後端分類。前端亦須依現有網站發布流程重新建置發布，再關閉並重開 LINE 網頁確認。

上線驗收：確認「糖果」啟用目錄為零食類 → 拍照辨識 → 核對頁應顯示零食類 → 使用測試據點／測試數量確認入庫 → 庫存清單應顯示零食類。品名修改成「糖」時，最後應採用調味料類。

## 既有錯誤紀錄

已入庫的糖果紀錄仍存著原本的食品分類。這次沒有自動修改歷史庫存，也沒有改數量、效期或合併批次；需在物資管理逐筆確認後將物資種類改為零食類。仍待確認的舊辨識紀錄則會在新確認函式中重新核對分類。
