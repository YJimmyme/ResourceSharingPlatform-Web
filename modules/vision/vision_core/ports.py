"""核心對外部系統的介面。主系統整合只需實作這些介面，不需修改核心。

實作位置：
- adapters/standalone.py           本機獨立模式（無登入、無主系統）
- adapters/host_supabase/          物資平台：Supabase 登入、目錄、照片、ai_stock_in_log
- adapters/openai_review.py        OpenAI 複核
"""
from dataclasses import dataclass, field
from typing import Optional, Protocol

ADMIN = 'admin'        # 標註、訓練、審核、發布
OPERATOR = 'operator'  # 只能在所屬據點辨識，並修正自己的辨識回饋


@dataclass
class Actor:
    """已通過驗證的操作者；role 為 ADMIN 或 OPERATOR。"""
    id: str
    role: str
    location_id: Optional[int] = None
    display_name: Optional[str] = None
    extra: dict = field(default_factory=dict)

    @property
    def is_admin(self):
        return self.role == ADMIN


class SecurityPolicy(Protocol):
    """HTTP 請求驗證。permission 為 'public'、'operate' 或 'admin'。

    cors_origins：允許跨網域呼叫 API 的網站來源（主系統與本服務不同網址時）。
    parent_origins：允許嵌入工作台並以 postMessage 傳入登入憑證的網站來源。
    """
    production: bool
    cors_origins: list
    parent_origins: list
    def authorize(self, request, permission: str) -> Optional[Actor]: ...


class CatalogProvider(Protocol):
    """主系統品項目錄。items 每筆至少含 item_name，可含 id、category、unit、stock_type。"""
    def items(self) -> list: ...
    def synonyms(self) -> list: ...  # [{'synonym':..., 'standard_name':...}]


class ImageSource(Protocol):
    """依主系統的照片參照取得原始位元組；須自行檢查 actor 是否有權讀取。"""
    def fetch(self, actor: Actor, reference: str) -> bytes: ...


class ReviewProvider(Protocol):
    """雲端複核。回傳 (parsed, audit)，parsed 含 objects、needs_review、uncertainty。"""
    def review(self, image, boxes: list, catalog: list, complexity: str) -> tuple: ...


class ResultSink(Protocol):
    """將辨識結果寫入主系統（例如待確認入庫紀錄），回傳寫入的列（需含 id）。"""
    def write(self, actor: Actor, request: dict, result: dict) -> list: ...


class OutcomeSource(Protocol):
    """讀回人工確認後的最終品項與數量，用於弱標註與線上準確率統計。"""
    configured: bool
    def outcomes(self, log_ids: list) -> list: ...


class NullOutcomeSource:
    """主系統尚未記錄確認結果時使用。"""
    configured = False
    def outcomes(self, log_ids):
        return []
