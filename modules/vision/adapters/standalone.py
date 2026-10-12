"""本機獨立模式：只接受本機網址，寫入請求須來自本機工作台；不需登入、不連主系統。"""
import os
from vision_core.errors import VisionError
from vision_core.ports import ADMIN, Actor


def local_origins(env=None):
    env = os.environ if env is None else env
    return ['http://127.0.0.1:' + env.get('AI_LAB_PORT', '5180'), 'http://127.0.0.1:' + env.get('VISION_PORT', '5182')]


class LocalSecurity:
    production = False
    cors_origins = []
    parent_origins = []

    def __init__(self, origins=None):
        self.origins = origins or local_origins()

    def authorize(self, request, permission):
        if request.host.split(':')[0] not in ['127.0.0.1', 'localhost']:raise VisionError('本機模式只接受本機網址', 403)
        if request.method == 'POST' and request.headers.get('Origin') not in self.origins:raise VisionError('請從本機標註頁操作', 403)
        return Actor(id='local', role=ADMIN, display_name='本機操作者')
