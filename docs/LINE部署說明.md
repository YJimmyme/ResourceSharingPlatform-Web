# LINE 功能部署說明

> 本檔整理 LINE 相關功能上線到 Supabase 需要做的事。資料表（`line_notification_settings`、
> `line_bindings`、`line_bind_codes`、`notification_state`）已包含在基礎 migration，雲端若已套用過
> 即不需再跑 SQL。本次「LINE 物資通報」**唯一新增的是 `line-broadcast` Edge Function**。

## 一、Edge Functions（在 Supabase Dashboard → Edge Functions → 以 Editor 建立／貼上）

需要存在的三支（前兩支若之前已部署就略過）：

| 函式 | 用途 | 狀態 |
|------|------|------|
| `line-webhook` | 接收 LINE 平台事件（綁定、加好友等） | 之前已部署 |
| `line-notify` | 自動警示通知（低庫存／即期／過期），內容系統自動產生 | 之前已部署 |
| **`line-broadcast`** | **本次新增**：推播「LINE 物資通報」頁組好的自訂訊息 | **需新部署** |

部署 `line-broadcast`：
1. Dashboard → Edge Functions → Create a new function，名稱填 **`line-broadcast`**。
2. 把專案 `supabase/functions/line-broadcast/index.ts` 的內容整段貼上、Deploy。
3. 不需另外設定環境變數：函式用的 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_ANON_KEY`
   都是 Supabase Edge 執行環境內建。

## 二、LINE OA 設定（Token）

1. 建立 LINE Official Account 與 Messaging API channel，取得 **Channel access token**（與 Channel secret）。
2. 登入系統 → 系統管理 → **LINE 通知設定**：填入 Channel access token、啟用通知。
   （這些值存進 `line_notification_settings`，三支函式都讀它。）
3. LINE 平台的 Webhook URL 指向 `line-webhook` 函式網址（供綁定／加好友事件）。

## 三、使用者綁定

- 推播只會送給 `line_bindings` 中 **已綁定且 `notify_enabled = true`** 的使用者。
- 綁定流程：帳號管理 →「產生綁定碼」給該帳號 → 使用者在 LINE 輸入綁定碼（由 `line-webhook` 處理）。

## 四、驗收「LINE 物資通報」

1. 以上都就緒後，系統管理 → **LINE 物資通報**。
2. 輸入訊息文字、篩選並勾選物資、核對公布數量 → 看右側預覽。
3. 按「推播」：成功會回「物資通報推播完成：成功 N、失敗 M」。
   - 若回「LINE 通知未啟用或尚未設定 Token」→ 回第二步填 Token。
   - 若回「目前沒有已綁定並開啟通知的 LINE 使用者」→ 先完成第三步綁定。
4. OA 尚未建立前，可先用「複製訊息」把內容貼到別處使用。

## 五、檢查清單

- [ ] `line-broadcast` 已部署
- [ ] LINE 通知設定已填 Channel access token 且啟用
- [ ] `line-webhook` 的 Webhook URL 已在 LINE 後台設定
- [ ] 至少一位使用者已綁定並開啟通知
- [ ] 在「LINE 物資通報」實際推播成功
