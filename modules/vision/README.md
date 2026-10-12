# AI 辨識模組（YOLO 標註、訓練、評估、發布與辨識率改善）

這個資料夾可單獨複製使用：不需要 React、Node、Supabase 或 OpenAI 金鑰，就能執行 YOLO 標註、訓練、評估及辨識。
與物資平台的整合全部透過 **轉接器（adapters）** 和 **HTTP API**，核心程式不認識 Supabase。

## 架構

```text
modules/vision/
├─ vision_core/            核心邏輯（不依賴 Flask、Supabase、OpenAI）
│   ├─ ports.py            ★ 與外部系統的介面：Actor、SecurityPolicy、CatalogProvider、ImageSource、
│   │                         ReviewProvider、ResultSink、OutcomeSource
│   ├─ config.py           讀 config/vision.yaml，環境變數可覆寫
│   ├─ service.py          VisionCore：把下列元件組成單一入口
│   ├─ dataset.py          標註、拍攝群組、不可變訓練快照
│   ├─ models.py           模型清單、評估紀錄、發布門檻、deployment.json
│   ├─ inference.py        YOLO 推論
│   ├─ jobs.py / training.py   訓練與評估子程序（python -m vision_core.training）
│   ├─ evaluation.py       數量正確率、各品項精確率／召回率、門檻掃描與校準、模型比較
│   ├─ policy.py           目錄標準化、何時交給雲端複核
│   ├─ recognition.py      正式辨識流程（YOLO → 標準化 → 複核 → 回饋 → 寫入主系統）
│   ├─ feedback.py         辨識回饋、審核優先度、納入資料集
│   └─ improvement.py      改善建議（下一步該補哪些照片）
├─ vision_http/app.py      Flask 路由；每條路由宣告權限（public / operate / admin）
├─ vision_ui/              工作台 workbench.html、標註頁 editor.html
├─ adapters/
│   ├─ standalone.py       本機獨立模式：只接受本機網址，不需登入
│   ├─ openai_review.py    ReviewProvider：OpenAI 複核
│   └─ host_supabase/      物資平台整合：client（Supabase API）、security（登入與角色）、
│                             catalog（品項目錄）、images（照片）、sink（寫 ai_stock_in_log）
├─ contracts/openapi.json  對外 API 契約
├─ config/vision.yaml      可調參數（門檻、解析度、訓練、評估、發布）
├─ bootstrap.py            組裝根：決定核心搭配哪個轉接器
├─ run.py                  本機獨立模式（127.0.0.1:5182）
├─ serve_dev.py            本機整合測試（127.0.0.1:8000，依環境變數選模式）
├─ wsgi.py                 正式部署（gunicorn wsgi:app）
└─ tests/
```

依賴方向只有一個：`adapters → vision_core ← vision_http`，`bootstrap.py` 負責把它們接起來。
要整合其他系統時，新增一個 `adapters/<系統名>/` 實作 ports 介面即可，不需修改核心。

### 與物資平台的整合點

| 主系統 | 本模組 |
|---|---|
| AI 智慧入庫頁上傳照片到 Supabase `ai-stockin` 儲存桶 | `ImageSource` 只讀取本人上傳的照片 |
| 呼叫 `POST /vision-api/api/v1/recognize` | `RecognitionService` 辨識後由 `ResultSink` 寫入 `ai_stock_in_log`（待確認） |
| 使用者在核對畫面修正 → `POST /feedback` | 回饋待管理員審核才進資料集 |
| 原有 `ai-stockin-confirm` 正式入庫 | 本模組**不**寫庫存 |
| 管理員「AI 模型管理」頁籤（iframe） | `/workbench`，以 postMessage 傳入登入憑證 |
| （待新增）入庫確認時記錄最終品項與數量 | `OutcomeSource` 已定義介面，等資料表變更後實作 |

## 辨識率改善機制

1. **資料：** 每次正式辨識都保存原圖和結果。使用者修正後送到回饋清單，系統依「YOLO 是否失手、修正幅度」排序，管理員優先審核最有價值的案例。
2. **改善建議（工作台「改善建議」頁）：** 列出各品項的訓練／驗證／測試框數、YOLO 漏判數、上線模型的精確率與召回率，並直接提示該補拍哪些品項。
3. **評估：** 保留集評估除了「每張品項與數量完全正確率」，還計算每個品項的精確率和召回率，並掃描 0.05–0.95 各門檻的表現。
4. **門檻校準：** 依評估找出每個品項「門檻以上精確率達 90%」的最低信心值。發布模型時一併套用，信心低於該品項門檻的框才送雲端複核，既減少不必要的雲端費用，也不放過不可靠的品項。
5. **發布門檻：** 新模型必須和目前上線模型在**同一份保留測試集**比較，而且不能退步才能啟用；回復先前發布過的模型則不受此限。

參數都在 `config/vision.yaml`。改設定後重新啟動服務即生效；每次訓練會把當時的參數寫進 `runs/<工作ID>/config.json`，方便追溯。

## 三個操作步驟

### 1. 照片標註

新增品項 → 選擇圖片 → 將每個可見實物框起來並指定品項 → 選資料用途 → 勾選已核對 → 保存。

數量由物件框計算，例如同一張照片有三瓶水，就畫三個「瓶裝水」框，不要把三瓶框成一個。資料用途：訓練用於學習，驗證用於訓練中挑選模型，保留測試用於最後評估。相同或連拍的近似照片應放在相同群組，避免跨集合造成評估失真。

### 2. 建立模型

只有一張照片時選 **單張練習**。正式訓練至少需要訓練、驗證各一張有框照片；這只是流程的最低要求，不代表資料足以辨識真實場景。

### 3. 比較、評估、啟用

選照片和模型 → 執行辨識，左邊是人工答案，右邊是模型預測。正式模型要先執行保留集評估。第一次啟用專屬模型前，也要用同一份保留集評估目前上線的模型（通常是通用模型），系統比較兩者後才允許啟用。

## 啟動方式

| 情境 | 方式 | 網址 |
|---|---|---|
| 本機獨立（不需主系統） | 雙擊 `啟動模組.cmd` 或 `python run.py` | http://127.0.0.1:5182/workbench |
| 舊測試入口（保留） | `ai-recognition-lab/啟動測試.cmd` | http://127.0.0.1:5180/yolo |
| 本機整合（本機 Supabase + 前端） | `deploy/local/啟動本機整合測試.cmd` | http://localhost:5173 |
| 正式 Linux | `deploy/compose.yaml` | 見 `deploy/部署與操作說明.md` |

同一個資料夾同時只能由一個服務使用（有檔案鎖），例如舊測試入口與本機整合不要同時指向 `ai-recognition-lab/yolo-data`。

| 環境變數 | 預設／用途 |
|---|---|
| VISION_PORT | run.py 為 5182；serve_dev.py 為 8000 |
| VISION_DATA_DIR | 本資料夾 data（舊名 YOLO_LAB_DATA 仍可用）；資料集、回饋、訓練輸出、啟用版本 |
| VISION_MODEL_DIR | 本資料夾 models；預訓練權重 |
| VISION_CONFIG | 另指定設定檔路徑；預設 config/vision.yaml |
| YOLO_INFERENCE_DEVICE | 覆寫 inference.device |
| YOLO_REVIEW_THRESHOLD | 覆寫 review.threshold |
| VISION_PRODUCTION | 1 = 主系統整合模式（需 SUPABASE_URL、SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY、APP_ORIGIN） |

## API

規格見 `contracts/openapi.json`（服務中可由 `/api/v1/openapi.json` 取得）。每條路徑同時提供 `/api/v1` 版本，新整合請使用 v1。

| 方法與路徑 | 權限 | 用途 |
|---|---|---|
| GET /health | 公開 | 服務狀態 |
| GET /status、/module | 管理 | 資料集、工作、模型、評估摘要、目前設定 |
| POST /classes、/prepare、/save；GET /sample/{id} | 管理 | 標註 |
| POST /predict | 管理 | 單張辨識：image、model、confidence → objects、counts |
| POST /train、/stop | 管理 | 訓練或評估（mode=train／evaluate） |
| GET /evaluation/{run} | 管理 | 完整評估報告 |
| POST /activate、/models/rename | 管理 | 發布（含退步檢查與門檻校準）、命名 |
| GET /improvement | 管理 | 改善建議 |
| GET/POST /catalog | 管理 | 標註類別 ↔ 主系統品項 ID |
| POST /export；GET /download/{id} | 管理 | 匯出 YOLO 資料集 |
| POST /recognize | 辨識 | （整合模式）正式入庫辨識 |
| POST /feedback | 辨識 | 提交修正 |
| GET /feedback-list、/feedback-detail/{id}；POST /approve-feedback | 管理 | 回饋審核 |

`objects` 格式：`[{"itemId":"品項ID或null","label":"瓶裝水","bbox":[0.1,0.2,0.4,0.8],"confidence":0.9}]`。bbox 為左、上、右、下，依圖片寬高正規化至 0–1。信心值不等於實測準確率。

## 測試

```sh
cd modules/vision
python -m unittest discover -s tests -v                       # 離線單元測試（假的 Supabase/OpenAI/YOLO）
python tests/smoke_standalone.py --weights ../../ai-recognition-lab/models   # 真實 CPU 訓練→評估→發布門檻
```

舊路徑 `ai-recognition-lab` 的 `python -m unittest test_yolo_data test_vision_service` 仍可執行，內容已改為呼叫這裡的測試。

## 備份與資料相容

資料目錄格式與先前版本相同（images、records、history、exports、runs、feedback、classes.json、catalog-mapping.json、deployment.json），新版可直接沿用舊資料。
舊版評估沒有「保留集指紋」，在發布門檻開啟時需重新評估一次才能啟用該模型。
備份時先停止訓練與服務，備份整個資料目錄和權重目錄。

Ultralytics 套件與權重採 AGPL-3.0／Enterprise 授權，正式散布或商用整合請依其條件處理：https://www.ultralytics.com/license
