"""Supabase REST／Auth／Storage 的最小用戶端；只在後端使用 service_role 金鑰。"""
import os
from dataclasses import dataclass
import requests
from vision_core.errors import VisionError


@dataclass
class HostSettings:
    """app_origins：主系統網站來源（可逗號分隔多個），允許跨網域呼叫並嵌入工作台。
    public_origin：本服務自己的對外網址；網站與服務不同網址時，工作台的寫入請求會帶這個來源。"""
    url: str
    anon_key: str
    service_key: str
    app_origins: list
    public_origin: str = ''

    @property
    def app_origin(self):
        return self.app_origins[0]

    @property
    def write_origins(self):
        return self.app_origins + ([self.public_origin] if self.public_origin else [])

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env
        missing = [k for k in ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_ORIGIN'] if not env.get(k)]
        if missing:raise RuntimeError('主系統整合模式缺少環境變數：' + ', '.join(missing))
        origins = [o.strip().rstrip('/') for o in env['APP_ORIGIN'].split(',') if o.strip()]
        return cls(env['SUPABASE_URL'].rstrip('/'), env['SUPABASE_ANON_KEY'], env['SUPABASE_SERVICE_ROLE_KEY'], origins,
                   env.get('VISION_PUBLIC_ORIGIN', '').strip().rstrip('/'))


class SupabaseClient:
    def __init__(self, settings):
        self.settings = settings

    def _service_headers(self):
        key = self.settings.service_key
        return {'apikey': key, 'Authorization': 'Bearer ' + key}

    def rest(self, path, method='GET', body=None):
        headers = {**self._service_headers(), 'Content-Type': 'application/json', 'Prefer': 'return=representation'}
        r = requests.request(method, self.settings.url + '/rest/v1/' + path, headers=headers, json=body, timeout=30)
        if not r.ok:raise VisionError('資料庫操作失敗，請檢查部署設定與資料表', 502)
        return r.json() if r.content else None

    def user(self, authorization):
        """以使用者的 Bearer token 向 Supabase Auth 查詢身分；失效回傳 None。"""
        r = requests.get(self.settings.url + '/auth/v1/user', headers={'apikey': self.settings.anon_key, 'Authorization': authorization}, timeout=15)
        return r.json() if r.ok else None

    def download(self, bucket, path):
        r = requests.get(self.settings.url + f'/storage/v1/object/{bucket}/' + requests.utils.quote(path, safe='/'), headers=self._service_headers(), timeout=30)
        return r.content if r.ok else None
