"""ImageSource：只允許讀取使用者本人上傳到 ai-stockin 儲存桶的照片。"""
from vision_core.errors import VisionError


class SupabaseImageSource:
    def __init__(self, client, bucket='ai-stockin', max_bytes=10 * 1024 * 1024):
        self.client = client; self.bucket = bucket; self.max_bytes = max_bytes

    def fetch(self, actor, reference):
        if not isinstance(reference, str) or not reference.startswith(actor.id + '/') or '..' in reference:raise VisionError('照片必須是本人上傳檔案', 403)
        content = self.client.download(self.bucket, reference)
        if content is None:raise VisionError('無法讀取照片')
        if len(content) > self.max_bytes:raise VisionError('照片上限10MB')
        return content
