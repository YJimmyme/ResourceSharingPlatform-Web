"""SecurityPolicy：Supabase 登入、帳號啟用、角色與來源檢查。

角色對應：Admin → admin（模型管理全部功能）；Cadre → operator（只能辨識與回饋）；其他角色不可使用。
"""
from vision_core.errors import VisionError
from vision_core.ports import ADMIN, OPERATOR, Actor

ROLE_MAP = {'Admin': ADMIN, 'Cadre': OPERATOR}


class SupabaseSecurity:
    production = True

    def __init__(self, client):
        settings = client.settings; self.client = client
        self.cors_origins = settings.app_origins          # 主系統網站（可跨網域呼叫 API）
        self.parent_origins = settings.app_origins        # 可嵌入工作台並傳入登入憑證
        self.write_origins = settings.write_origins       # POST 允許的 Origin（含本服務自己的工作台）

    def authorize(self, request, permission):
        if permission == 'public':return None
        if request.method not in ['GET', 'POST']:raise VisionError('不支援的方法', 405)
        if request.method == 'POST' and request.headers.get('Origin') not in self.write_origins:raise VisionError('來源不符', 403)
        token = request.headers.get('Authorization', '')
        if not token.startswith('Bearer '):raise VisionError('請先登入', 401)
        user = self.client.user(token)
        if not user:raise VisionError('登入已失效', 401)
        rows = self.client.rest('profiles?id=eq.' + user['id'] + '&select=id,role_name,location_id,is_active,display_name,username')
        if not rows or not rows[0]['is_active']:raise VisionError('帳號未啟用', 403)
        profile = rows[0]; role = ROLE_MAP.get(profile['role_name'])
        if permission == 'operate' and role not in [ADMIN, OPERATOR]:raise VisionError('沒有入庫權限', 403)
        if permission == 'admin' and role != ADMIN:raise VisionError('限管理員操作', 403)
        return Actor(id=profile['id'], role=role, location_id=profile.get('location_id'),
                     display_name=profile.get('display_name') or profile.get('username'), extra=profile)
