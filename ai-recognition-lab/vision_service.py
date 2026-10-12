"""舊版相容：主系統整合已移至 modules/vision/adapters/host_supabase（依職責拆成登入、目錄、照片、紀錄寫入）。

新程式請改用 bootstrap.host_app()；此檔只保留舊匯入路徑。
"""
import _vision_bridge
from adapters.host_supabase import build
