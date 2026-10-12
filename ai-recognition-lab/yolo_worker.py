"""舊版相容入口（埠 5181）：由 server.mjs／啟動測試.cmd 啟動，實際服務來自 modules/vision。

VISION_PRODUCTION=1 時為主系統整合模式（Supabase 登入），否則為本機獨立模式。
"""
import os
import _vision_bridge
from bootstrap import app_from_env,claim_data
app=app_from_env()
if __name__=='__main__' or os.environ.get('VISION_LOCK_DATA')=='1':claim_data(app)
if __name__=='__main__':app.run(host='127.0.0.1',port=int(os.environ.get('YOLO_LAB_PORT',5181)),threaded=True,use_reloader=False)
