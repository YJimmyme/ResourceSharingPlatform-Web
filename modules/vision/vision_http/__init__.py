"""HTTP 傳輸層：只負責路由、權限宣告與錯誤格式，業務邏輯在 vision_core。"""
from .app import create_app

__all__ = ['create_app']
