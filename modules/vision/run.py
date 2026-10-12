"""Standalone localhost server. Run without the host application or Supabase."""
import os
if os.environ.get('VISION_PRODUCTION')=='1':raise SystemExit('Use the host authentication adapter for production deployment.')
from bootstrap import standalone_app,claim_data
app=claim_data(standalone_app())
port=int(os.environ.get('VISION_PORT',5182))
print(f'YOLO 模組：http://127.0.0.1:{port}/workbench',flush=True)
app.run(host='127.0.0.1',port=port,threaded=True,use_reloader=False)
