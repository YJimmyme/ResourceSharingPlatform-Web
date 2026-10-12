"""物資平台（Supabase）整合轉接器。

build(core) 依環境變數組出 SecurityPolicy 與 RecognitionService：
  SUPABASE_URL、SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY、APP_ORIGIN（必要）
  OPENAI_API_KEY、OPENAI_MODEL、OPENAI_COMPLEX_MODEL（選用；未設定時需人工核對）

OutcomeSource 尚未實作：等 ai_stock_in_log 記錄人工確認後的最終值（資料表變更另案進行），
再於此新增 outcome.py 並在 build() 傳給 core.outcomes。
"""
import os
from vision_core.recognition import RecognitionService
from ..openai_review import OpenAIReviewer
from .catalog import SupabaseCatalog
from .client import HostSettings, SupabaseClient
from .images import SupabaseImageSource
from .security import SupabaseSecurity
from .sink import StockInLogSink


def build(core, env=None):
    env = os.environ if env is None else env
    client = SupabaseClient(HostSettings.from_env(env))
    recognition = RecognitionService(core, SupabaseCatalog(client), SupabaseImageSource(client), StockInLogSink(client), OpenAIReviewer.from_env(env))
    return SupabaseSecurity(client), recognition
