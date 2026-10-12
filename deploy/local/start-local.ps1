# 本機整合測試：本機 Supabase + 辨識服務（主系統整合模式）+ 前端開發伺服器。
# 需求：Docker Desktop 執行中、Node.js、ai-recognition-lab\.venv-yolo（安裝YOLO.cmd 建立）。
# 用法（專案根目錄）：powershell -ExecutionPolicy Bypass -File deploy\local\start-local.ps1
param(
    [string]$VisionDataDir = '',
    [switch]$Reset   # 重建本機資料庫：重新套用所有 migration 與 seed.sql（會清空本機資料）
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw '找不到 docker。請先安裝並啟動 Docker Desktop。' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker 尚未啟動。請開啟 Docker Desktop，等待 Engine running 後再執行。' }
$Python = Join-Path $Root 'ai-recognition-lab\.venv-yolo\Scripts\python.exe'
if (-not (Test-Path $Python)) { throw '找不到 YOLO Python 環境，請先執行 ai-recognition-lab\安裝YOLO.cmd' }

Write-Host '== 1/4 啟動本機 Supabase（第一次需下載映像，約數分鐘）'
npx --yes supabase@2 start
if ($LASTEXITCODE -ne 0) { throw 'supabase start 失敗' }
if ($Reset) { npx --yes supabase@2 db reset; if ($LASTEXITCODE -ne 0) { throw 'supabase db reset 失敗' } }

Write-Host '== 2/4 讀取本機金鑰並產生設定檔'
$status = @{}
npx --yes supabase@2 status -o env | ForEach-Object {
    if ($_ -match '^([A-Z_]+)="?([^"]*)"?$') { $status[$Matches[1]] = $Matches[2] }
}
foreach ($k in 'API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY') { if (-not $status[$k]) { throw "supabase status 缺少 $k" } }

$Origin = 'http://localhost:5173'
# 預設用獨立資料夾：整合模式辨識時會把主系統目錄品項加入類別、保存回饋，避免動到 yolo-data 的正式標註。
# 第一次會複製 yolo-data 作為起點；要直接使用 yolo-data 請加 -VisionDataDir 指定。
if (-not $VisionDataDir) {
    $VisionDataDir = Join-Path $Root 'ai-recognition-lab\yolo-data-local'
    $source = Join-Path $Root 'ai-recognition-lab\yolo-data'
    if (-not (Test-Path $VisionDataDir) -and (Test-Path $source)) {
        Copy-Item $source $VisionDataDir -Recurse
        Remove-Item (Join-Path $VisionDataDir '.service.lock') -ErrorAction SilentlyContinue
    }
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
# 前端：只在 npm run dev 讀取，不會影響 npm run build 的正式建置（已被 .gitignore 排除）
[IO.File]::WriteAllText((Join-Path $Root '.env.development.local'), @"
VITE_SUPABASE_URL=$($status['API_URL'])
VITE_SUPABASE_ANON_KEY=$($status['ANON_KEY'])
VITE_RECOGNITION_API_URL=/vision-api
VITE_BASE_PATH=/
"@, $utf8)
# 辨識服務（deploy\local\.env.vision 已被 .gitignore 排除）
$visionEnv = [ordered]@{
    VISION_PRODUCTION = '1'; VISION_PORT = '8000'; VISION_DATA_DIR = $VisionDataDir
    VISION_MODEL_DIR = (Join-Path $Root 'ai-recognition-lab\models')
    SUPABASE_URL = $status['API_URL']; SUPABASE_ANON_KEY = $status['ANON_KEY']; SUPABASE_SERVICE_ROLE_KEY = $status['SERVICE_ROLE_KEY']
    APP_ORIGIN = $Origin; PYTHONIOENCODING = 'utf-8'
}
if ($env:OPENAI_API_KEY) { $visionEnv['OPENAI_API_KEY'] = $env:OPENAI_API_KEY }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot '.env.vision'), (($visionEnv.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`r`n"), $utf8)

Write-Host '== 3/4 啟動辨識服務（新視窗，埠 8000）'
$envLines = ($visionEnv.GetEnumerator() | ForEach-Object { "`$env:$($_.Key)='$($_.Value -replace "'", "''")'" }) -join '; '
Start-Process powershell -ArgumentList '-NoExit', '-Command', "$envLines; Set-Location '$Root\modules\vision'; & '$Python' serve_dev.py"

Write-Host '== 4/4 啟動前端（新視窗，埠 5173）'
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$Root'; cmd /c 'npm run dev -- --host localhost --port 5173 --strictPort'"  # Windows PowerShell 會吃掉 --，改由 cmd 傳遞

Write-Host ''
Write-Host "前端：     $Origin/#/login"
Write-Host "Studio：   http://127.0.0.1:54323"
Write-Host '測試帳號：見 supabase\seed.sql 開頭註解（local_admin / local_cadre）'
if ($visionEnv.Contains('OPENAI_API_KEY')) {
    Write-Host 'OpenAI 複核：已偵測到 OPENAI_API_KEY，需要複核的照片會實際呼叫 OpenAI（使用你的 API 額度）。' -ForegroundColor Yellow
    Write-Host '           不想呼叫時，先執行 $env:OPENAI_API_KEY=$null 再重新啟動。'
} else {
    Write-Host 'OpenAI 複核：未設定 OPENAI_API_KEY，需要複核的照片會改為人工核對。'
}
Write-Host "辨識資料夾：$VisionDataDir"
Write-Host '停止：powershell -File deploy\local\stop-local.ps1'
