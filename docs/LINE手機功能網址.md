# LINE 手機功能網址

正式網站：<https://yunfull-mm.org.tw/ResourceSharingPlatform-Web/>

| 功能 | 圖文選單網址 |
|---|---|
| 物資查詢 | https://yunfull-mm.org.tw/ResourceSharingPlatform-Web/#/mobile/inventory |
| 物資領用 | https://yunfull-mm.org.tw/ResourceSharingPlatform-Web/#/mobile/pickup |
| 物資轉讓 | https://yunfull-mm.org.tw/ResourceSharingPlatform-Web/#/mobile/transfer |
| 影像入庫 | https://yunfull-mm.org.tw/ResourceSharingPlatform-Web/#/mobile/vision |

網域後使用單一 `/`，不要寫成 `org.tw//ResourceSharingPlatform-Web/`。保留 `/#/mobile/...`：網站使用 HashRouter，這部分由前端處理，不是伺服器目錄。

## 程式已調整

正式站文件、AI 服務的 APP_ORIGIN 範例、跨網域 iframe 與 CORS 說明及相關測試已改用新網域。四個手機路由本身使用相對路徑，沒有綁定舊網域。登入頁原有邏輯會保留 `/mobile/*` 目的地；功能權限限制保持原樣。

## 線上設定需同步

1. 在 LINE Official Account Manager 的圖文選單編輯頁，將四個動作網址替換為上表內容，儲存並發布。Webhook 本身沒有儲存這四個網址。
2. 若有使用 LIFF，檢查 LINE Developers 中該 LIFF 的 Endpoint URL，替換舊網域並保留原本指定路徑。
3. 若有使用 Supabase 登入回呼，更新 Authentication / URL Configuration 的 Site URL 與 Redirect URLs，允許新網站對應路徑。
4. 若啟用 Python YOLO／OpenAI 整合服務，實際部署的 `APP_ORIGIN` 應為 `https://yunfull-mm.org.tw`，不含尾端斜線或網站路徑；更新部署環境後重新啟動服務。僅修改範例檔不會更新伺服器上的環境變數。

## 驗證範圍（2026-10-13）

新網站入口回覆 HTTP 200；HTML 引用的 JavaScript、CSS 均回覆 HTTP 200 且內容類型正確，線上 JavaScript 包含四個 `/mobile/*` 路由。目前站台的資源位於 `/assets/`；不需手動改寫線上資源路徑。本機 Vite 保留原有 `/ResourceSharingPlatform-Web/` 部署路徑。

此檢查沒有登入使用者帳號、操作真實領用／轉讓／入庫，也沒有修改 LINE、LIFF、Supabase 或伺服器的線上設定。本機修改尚未推送或部署。
