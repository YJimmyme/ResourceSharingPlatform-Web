# 產生「在另一台電腦用 Docker 部署 AI 辨識服務」的檔案包。網站仍由 GitHub Pages 部署，不在檔案包內。
# 用法（專案根目錄）：powershell -ExecutionPolicy Bypass -File deploy\make-deploy-package.ps1 [-WithVisionData]
#   -WithVisionData  另外打包 ai-recognition-lab\yolo-data（標註、回饋、訓練模型）成 vision-data.zip，供新電腦匯入
param([switch]$WithVisionData)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
# Compress-Archive（Windows PowerShell 5.1）會把中文檔名存成亂碼，改用 .NET 寫入 UTF-8 檔名
function New-Zip($dir, $zip) {
    if (Test-Path $zip) { Remove-Item $zip -Force }
    [IO.Compression.ZipFile]::CreateFromDirectory($dir, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
}
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$OutDir = Join-Path $Root "deploy-package-$Stamp"
$Stage = Join-Path $env:TEMP "rsp-deploy-$Stamp"
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force $Stage, $OutDir | Out-Null

# 辨識服務映像需要的內容：modules/vision 與只含辨識服務的 compose 設定
$items = @('.dockerignore', 'modules\vision', 'deploy\compose.vision.yaml', 'deploy\Dockerfile.vision', 'deploy\.env.vision.example', 'deploy\Docker部署步驟.md')
foreach ($item in $items) {
    $src = Join-Path $Root $item
    if (-not (Test-Path $src)) { throw "缺少 $item" }
    $dst = Join-Path $Stage $item
    New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
    Copy-Item $src $dst -Recurse
}
# 排除本機產物與機密：虛擬環境、資料、權重、快取、本機金鑰檔、舊的檔案包
Get-ChildItem $Stage -Recurse -Force -Directory | Where-Object { $_.Name -in @('__pycache__', '.venv', 'data', 'models', 'node_modules') -or $_.Name -like 'deploy-package-*' } |
    Sort-Object FullName -Descending | ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
Get-ChildItem $Stage -Recurse -Force -File | Where-Object { $_.Name -eq '.env' -or ($_.Name -like '.env.*' -and $_.Name -notlike '*.example') -or $_.Name -like '*.log' -or $_.Name -like 'deploy-package-*.zip' } |
    ForEach-Object { Remove-Item $_.FullName -Force }

New-Zip $Stage (Join-Path $OutDir 'source.zip')
Remove-Item $Stage -Recurse -Force

if ($WithVisionData) {
    $data = Join-Path $Root 'ai-recognition-lab\yolo-data'
    if (-not (Test-Path $data)) { throw "找不到 $data" }
    $tmp = Join-Path $env:TEMP "rsp-vision-data-$Stamp"
    Copy-Item $data $tmp -Recurse
    Remove-Item (Join-Path $tmp '.service.lock') -ErrorAction SilentlyContinue
    New-Zip $tmp (Join-Path $OutDir 'vision-data.zip')
    Remove-Item $tmp -Recurse -Force
}
Copy-Item (Join-Path $PSScriptRoot 'Docker部署步驟.md') $OutDir
Write-Host "完成：$OutDir"
Get-ChildItem $OutDir | ForEach-Object { Write-Host ("  {0}  {1:N1} MB" -f $_.Name, ($_.Length / 1MB)) }
