"""正式部署入口（gunicorn wsgi:app）。必須單一 worker，避免多程序同時寫資料目錄。"""
import os
from bootstrap import app_from_env, claim_data

app = app_from_env()
if os.environ.get('VISION_LOCK_DATA', '1') == '1':claim_data(app)
