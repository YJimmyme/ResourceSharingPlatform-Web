"""核心與傳輸層共用的錯誤型別；status 對應 HTTP 狀態碼。"""


class VisionError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message); self.status = status
