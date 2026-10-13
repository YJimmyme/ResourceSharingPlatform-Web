# 部署 AI 辨識服務（愛心轉運站的 AI 智慧入庫功能）

愛心轉運站網站**使用正式網域**（https://yunfull-mm.org.tw/ResourceSharingPlatform-Web/），不另外架網站。
只把 AI 辨識服務放到另一台已對外提供服務的電腦，經由那台電腦既有的 HTTPS 網址提供給網站呼叫。

```text
使用者瀏覽器
  ├─ 愛心轉運站（GitHub Pages，原本網址）
  │     └─ AI 智慧入庫／AI 模型管理 ──HTTPS──┐
  └─ Supabase（原本的資料庫、登入、照片）     │
                                              ▼
                     另一台電腦：既有 HTTPS 網站伺服器（反向代理）
                                              │ 轉到 127.0.0.1:8000
                                              ▼
                                   Docker 容器：AI 辨識服務
```

影響範圍：只有 AI 智慧入庫的照片辨識、AI 模型管理頁、手機影像入庫入口。其他頁面與資料庫不變。
辨識服務只會新增「待確認」的 AI 入庫紀錄（`ai_stock_in_log`），正式入庫仍由原本流程確認。

## 0. 準備

| 項目 | 需求 |
|---|---|
| 子網域 | 例如 `vision.你的網域`，DNS 指到那台電腦，並有 HTTPS 憑證（或用既有憑證管理方式申請） |
| Docker | Linux：Docker Engine + Compose v2；Windows：Docker Desktop |
| 硬體 | 記憶體 4 GB 以上（訓練建議 8 GB）、硬碟可用 10 GB 以上 |
| 網路 | 第一次建置需下載 PyTorch（CPU 版）與 YOLO 權重 |

以下用 `https://vision.example.org` 代表你的辨識服務網址，請換成實際網址。

## 1. 在這台電腦產生檔案包

```bat
powershell -ExecutionPolicy Bypass -File deploy\make-deploy-package.ps1 -WithVisionData
```

產生 `deploy-package-日期時間\`：

- `source.zip`：辨識服務的程式與 Docker 設定（不含網站、金鑰、資料）
- `vision-data.zip`：目前的標註、回饋、訓練模型（加 `-WithVisionData` 才有，選用）
- 本說明

複製到另一台電腦並解壓 `source.zip`（例如 `/opt/rsp-vision` 或 `C:\rsp-vision`）。以下指令都在解壓後的資料夾執行。

## 2. 填寫設定

```sh
cp deploy/.env.vision.example deploy/.env.vision      # Windows：copy deploy\.env.vision.example deploy\.env.vision
```

| 欄位 | 填什麼 |
|---|---|
| SUPABASE_URL、SUPABASE_ANON_KEY | 和網站相同的 Supabase 專案（後台 → Project Settings → API） |
| SUPABASE_SERVICE_ROLE_KEY | service_role key，**機密，只放這個檔案** |
| APP_ORIGIN | `https://yunfull-mm.org.tw`（只有協定和主機，**不含** `/ResourceSharingPlatform-Web/`） |
| VISION_PUBLIC_ORIGIN | `https://vision.example.org`（辨識服務對外網址，不含結尾斜線） |
| VISION_PORT | 容器在主機上的埠，預設 8000，只綁 127.0.0.1；被占用就換一個，反向代理一起改 |
| OPENAI_API_KEY | 雲端複核用；留空就不呼叫 OpenAI，需複核的照片改人工核對 |

## 3. 啟動辨識服務

```sh
docker compose --env-file deploy/.env.vision -f deploy/compose.vision.yaml up -d --build
docker compose --env-file deploy/.env.vision -f deploy/compose.vision.yaml ps
```

第一次約 5–15 分鐘。顯示 `healthy` 後，在那台電腦上確認：

```sh
curl http://127.0.0.1:8000/health
```

## 4. 在既有網站伺服器加上反向代理

讓 `https://vision.example.org` 轉到 `http://127.0.0.1:8000`。依你目前使用的伺服器擇一。

**nginx**

```nginx
server {
    listen 443 ssl;
    server_name vision.example.org;
    ssl_certificate     /path/to/fullchain.pem;    # 沿用你現有的憑證設定
    ssl_certificate_key /path/to/privkey.pem;
    client_max_body_size 64m;                      # 照片與標註資料
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;                    # 辨識與雲端複核可能較久
        proxy_send_timeout 300s;
    }
}
```

**Caddy**

```text
vision.example.org {
    request_body { max_size 64MB }
    reverse_proxy 127.0.0.1:8000 {
        transport http { read_timeout 300s }
    }
}
```

**Apache**（需啟用 mod_proxy、mod_proxy_http）

```apache
<VirtualHost *:443>
    ServerName vision.example.org
    # SSL 設定沿用現有站台
    LimitRequestBody 67108864
    ProxyPreserveHost On
    ProxyTimeout 300
    ProxyPass        / http://127.0.0.1:8000/
    ProxyPassReverse / http://127.0.0.1:8000/
</VirtualHost>
```

IIS 請使用 URL Rewrite + Application Request Routing 建立同樣的反向代理，並把要求大小上限調到 64 MB、逾時 300 秒。

**注意：** AI 模型管理頁會用 iframe 嵌入 `https://vision.example.org/workbench`。如果伺服器全域加了 `X-Frame-Options: DENY/SAMEORIGIN` 或 `Content-Security-Policy: frame-ancestors`，請在這個站台移除，或改成允許 `https://yunfull-mm.org.tw`，否則 AI 模型管理頁會是空白。

設定後在任一台電腦確認：`https://vision.example.org/health` 應回傳 `{"status":"ok",...}`。

## 5. 讓愛心轉運站啟用辨識服務

1. GitHub 專案 → Settings → Secrets and variables → Actions → **Variables** 分頁 → New repository variable
   - Name：`VITE_RECOGNITION_API_URL`
   - Value：`https://vision.example.org`（不含結尾斜線、不加 `/api/v1`）
2. 確認 `.github/workflows/deploy-pages.yml` 已含這一行（本次更新已加入）：
   `VITE_RECOGNITION_API_URL: ${{ vars.VITE_RECOGNITION_API_URL }}`
3. 推送到 main，或在 Actions 頁手動執行「Deploy GitHub Pages」。

沒有設定這個變數時，網站行為和原本完全相同；要暫停辨識服務，刪除變數後重新部署即可。

## 6.（選用）匯入現有標註與模型

```sh
mkdir vision-data && cd vision-data && unzip ../vision-data.zip && cd ..
docker compose --env-file deploy/.env.vision -f deploy/compose.vision.yaml cp ./vision-data/. vision:/data/
docker compose --env-file deploy/.env.vision -f deploy/compose.vision.yaml restart vision
```

Windows 解壓用 `Expand-Archive vision-data.zip -DestinationPath vision-data`。從舊電腦搬來的評估紀錄需重新評估一次，專屬模型才能啟用。

## 7. 驗收

1. 開愛心轉運站原本網址，強制重新整理（Ctrl+F5），用原本帳號登入。
2. 管理員：「AI 模型管理」應出現模型管理工作台，不是「請先設定…」，也不是一直「等待主系統登入授權」。
3. AI 智慧入庫應出現「照片辨識：YOLO 優先…」提示；上傳照片 → 辨識 → 核對 → 確認入庫。
4. 辨識結果下方「辨識錯誤？框選並提交正確答案」可提交回饋；管理員在 AI 模型管理可看到並審核。
5. 其他頁面（物資、捐贈、領用、調撥等）照常操作。

## 8. 辨識服務的行為設定

在 `modules/vision/config/vision.yaml`，**建置時打包進映像**，修改後重新執行第 3 步。

| 設定 | 預設 | 說明 |
|---|---|---|
| release.regression_gate | true | 啟用新模型前須和上線模型在同一份保留集比較不退步；false 則評估完成即可啟用（舊版行為） |
| review.use_calibrated_thresholds | true | 啟用模型時套用各品項校準門檻；false 則全部用 YOLO_REVIEW_THRESHOLD |

## 9. 更新、備份、停止

```sh
# 更新程式（保留 deploy/.env.vision）
docker compose --env-file deploy/.env.vision -f deploy/compose.vision.yaml up -d --build
# 備份標註、回饋、模型
docker compose --env-file deploy/.env.vision -f deploy/compose.vision.yaml cp vision:/data ./backups/vision-data
# 停止（資料保留）
docker compose --env-file deploy/.env.vision -f deploy/compose.vision.yaml down
```

**不要加 `-v`**，`down -v` 會刪除所有標註與模型。

## 10. 常見問題

| 狀況 | 原因與處理 |
|---|---|
| AI 智慧入庫按辨識後出現網路錯誤，瀏覽器主控台有 CORS 字樣 | `APP_ORIGIN` 不是 `https://yunfull-mm.org.tw`（多了路徑或斜線），改 `.env.vision` 後 `up -d` |
| 辨識時「來源不符」 | 同上；或從工作台操作時 `VISION_PUBLIC_ORIGIN` 和實際網址不一致 |
| AI 模型管理空白 | 伺服器送出 X-Frame-Options 或 frame-ancestors 阻擋嵌入（見第 4 步注意） |
| AI 模型管理一直「等待主系統登入授權」 | `APP_ORIGIN` 不正確，工作台不接受網站傳來的登入 |
| 網站仍顯示「請先設定 VITE_RECOGNITION_API_URL」 | GitHub 變數未設或未重新部署；瀏覽器 Ctrl+F5 |
| 瀏覽器顯示 Mixed Content | `VITE_RECOGNITION_API_URL` 用了 http，必須是 https |
| 照片上傳後 413 | 反向代理的上傳大小上限太小，調到 64 MB |
| 辨識逾時 504 | 反向代理逾時太短，調到 300 秒 |
| 「登入已失效」 | `SUPABASE_URL`／金鑰和網站不是同一個專案 |
| 啟動時 `ports are not available` | 主機的 `VISION_PORT` 被占用或被 Windows 保留，換一個埠並同步修改反向代理 |

訓練會吃滿 CPU，建議在非尖峰時段進行。服務只用單一程序，請不要調高 gunicorn worker 數。
