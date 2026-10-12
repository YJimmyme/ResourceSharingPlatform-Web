"""本機整合測試入口：依環境變數啟動（VISION_PRODUCTION=1 為主系統整合模式），只綁定 127.0.0.1。

正式 Linux 部署請用 gunicorn wsgi:app（見 deploy/Dockerfile.vision）。
"""
import os
from bootstrap import app_from_env, claim_data

app = claim_data(app_from_env())
port = int(os.environ.get('VISION_PORT', 8000))
print(f"辨識服務（{'主系統整合' if os.environ.get('VISION_PRODUCTION') == '1' else '本機獨立'}模式）：http://127.0.0.1:{port}/health", flush=True)
app.run(host='127.0.0.1', port=port, threaded=True, use_reloader=False)
