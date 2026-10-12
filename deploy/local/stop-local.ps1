# 停止本機 Supabase（資料保留，下次 start-local.ps1 會沿用）。辨識服務與前端請直接關閉它們的視窗。
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
npx --yes supabase@2 stop
