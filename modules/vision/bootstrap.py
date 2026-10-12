"""組裝根：決定核心搭配哪個轉接器。所有啟動入口（run.py、wsgi.py、舊 lab 入口）都從這裡建立服務。"""
import os
from vision_core.locking import acquire
from vision_core.service import VisionCore
from vision_http import create_app


def standalone_app(core=None, origins=None):
    from adapters.standalone import LocalSecurity
    core = core or VisionCore()
    app = create_app(core, LocalSecurity(origins)); app.vision_core = core
    return app


def host_app(core=None, env=None):
    from adapters import host_supabase
    core = core or VisionCore()
    security, recognition = host_supabase.build(core, env)
    app = create_app(core, security, recognition); app.vision_core = core
    return app


def app_from_env(env=None):
    """VISION_PRODUCTION=1 時為主系統整合模式，否則為本機獨立模式。"""
    env = os.environ if env is None else env
    return host_app(env=env) if env.get('VISION_PRODUCTION') == '1' else standalone_app()


def claim_data(app):
    """同一資料目錄只能由一個服務使用；取得鎖之後才回復中斷的工作。"""
    core = app.vision_core
    try:
        acquire(core.data)
    except RuntimeError as exc:
        raise SystemExit(str(exc)) from None
    core.jobs.recover()
    return app
