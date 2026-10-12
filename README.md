# 地方物資管理平台（Web 版）

面向地方社福據點的物資庫存管理系統。原為 ASP.NET Core MVC（.NET 8 + SQL Server + IIS）內部系統，本專案將其**完整改寫**為前端部署於 **GitHub Pages**、後端使用 **Supabase** 的雲端版本。

- 正式站：<https://bill1114.github.io/ResourceSharingPlatform-Web/>
- 前端：React 19 + Vite + TypeScript（HashRouter，靜態部署）
- 後端：Supabase（Postgres + Auth + Storage + Edge Functions）
- UI：Bootstrap 5 + Bootstrap Icons

---

## 快速開始（開發）

```bash
npm install
npm run dev        # 本機開發：http://localhost:5173
npm run build      # 產生 dist/（tsc -b && vite build）
npm run lint       # oxlint
```

環境變數（`.env`，前端建置時注入；正式站由 GitHub Actions secrets 提供）：

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
```

> 機密金鑰（service_role、OpenAI、LINE token）**不放前端**，見 [docs/資料庫與資料流.md](docs/資料庫與資料流.md)。

---

## 主要功能

| 分類 | 功能 |
|---|---|
| 戰情總覽 | 四色狀態卡（據點低庫存／總量不足·啟動募資／即將過期／已過期，可點擊進狀態清單）、各據點狀態統計、待處理缺料需求（舉手） |
| 狀態清單 | 由色卡點入，列出該狀態的物資；缺料可「舉手」提出需求（連結到轉移補貨），已過期則直接「報廢」 |
| 物資管理 | 物資清單（關鍵字/據點/種類/**狀態**篩選、跨據點統計、詳細/編輯/轉移/刪除、Excel 匯出）、物資入庫（可填捐贈人） |
| 物資異動 | 出庫（批次多品項、領用人分區/身分別、可回庫）、報廢、跨據點轉移（建立→確認→取消狀態機）、AI 影像入庫；**送出前皆有確認視窗** |
| 紀錄查詢 | 出庫/捐贈/報廢/轉移/AI 辨識紀錄、領取分析（樞紐多篩選）、**捐贈分析（含物流追蹤）**、Excel 匯出 |
| 系統管理 | 物資清單、**物資明細（異動歷程＋盤點調整，總管專用）**、帳號管理、據點管理、庫存種類設定（含依規格的募資門檻）、LINE／AI 設定 |
| 手機/LINE | 全螢幕手機頁面（物資查詢/領用/轉讓/影像入庫），供 LINE 圖文選單串接 |

角色：**總管理人員（Admin）／據點管理人員（Cadre）／物資小天使（SocialWorker）**，非總管以「所屬據點」限縮資料範圍（RLS）。

> 「物資捐贈」獨立頁已移除：捐贈人統一於**物資入庫**時填寫；入庫當下沒填的，可在**捐贈紀錄**補登／編輯／刪除（只動來源紀錄、不影響庫存）。

---

## 文件索引（`docs/`）

| 文件 | 內容 | 對象 |
|---|---|---|
| [專案總覽（本檔）](README.md) | 專案簡介、啟動、索引 | 全部 |
| [系統架構.md](docs/系統架構.md) | 整體架構、部署拓撲、技術選型 | 研發／維運 |
| [程式結構.md](docs/程式結構.md) | 前端目錄與檔案職責 | 研發 |
| [模組說明.md](docs/模組說明.md) | 各功能模組（頁面 / Edge Function）逐一說明 | 研發 |
| [流程圖.md](docs/流程圖.md) | 登入、出庫、轉移、AI 入庫、LINE 等流程圖 | 全部 |
| [使用邏輯架構.md](docs/使用邏輯架構.md) | 權限、資料範圍、狀態機等使用邏輯 | 研發／PM |
| [資料庫與資料流.md](docs/資料庫與資料流.md) | 資料表、View、RLS、Edge Function 對應 | 研發 |
| [使用說明書_客戶.md](docs/使用說明書_客戶.md) | 各功能操作步驟 | 客戶／使用者 |
| [開發修改說明_研發.md](docs/開發修改說明_研發.md) | 部署流程、如何改功能、注意事項 | 研發 |

---

## 部署

`dev` 分支開發，準備好後合併到 `main`，由 GitHub Actions（`.github/workflows/deploy-pages.yml`）自動建置部署到 GitHub Pages。資料庫 migration 與 Edge Function 由 Supabase Dashboard 手動部署。詳見 [開發修改說明_研發.md](docs/開發修改說明_研發.md)。

## 備份

每週自動備份 Supabase 資料庫與圖片，見 [Markdown/BackupPlan.md](Markdown/BackupPlan.md)。
