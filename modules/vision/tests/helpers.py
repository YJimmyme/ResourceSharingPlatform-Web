"""測試共用：隔離的暫存資料目錄與核心實例，不讀寫使用者資料。"""
import base64, io, sys, tempfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:sys.path.insert(0, str(ROOT))

from vision_core.config import load_config  # noqa: E402
from vision_core.service import VisionCore  # noqa: E402
from vision_core.storage import write_json  # noqa: E402


def png(color='white', size=(80, 80)):
    b = io.BytesIO(); Image.new('RGB', size, color).save(b, format='PNG'); return b.getvalue()


def data_url(color='white', size=(80, 80)):
    return 'data:image/png;base64,' + base64.b64encode(png(color, size)).decode()


def make_core(test, **overrides):
    temp = tempfile.TemporaryDirectory(); test.addCleanup(temp.cleanup)
    root = Path(temp.name)
    config = load_config(env={'VISION_DATA_DIR': str(root / 'data'), 'VISION_MODEL_DIR': str(root / 'models')}, overrides=overrides)
    return VisionCore(config)


def fake_trained_model(core, id, practice=False, config=None):
    run = core.data / 'runs' / id; weights = run / 'train/weights/best.pt'; weights.parent.mkdir(parents=True); weights.touch()
    write_json(run / 'config.json', {'practiceOnly': practice, **(config or {})}); write_json(run / 'state.json', {'status': 'completed', 'mode': 'train'})
    return run


def fake_evaluation(core, model_id, run_id, report=None, finished='2026-10-09T00:00:00'):
    run = core.data / 'runs' / run_id
    write_json(run / 'config.json', {'modelId': model_id, 'mode': 'evaluate'})
    write_json(run / 'state.json', {'status': 'completed', 'mode': 'evaluate', 'finished': finished})
    if report is not None:write_json(run / 'evaluation.json', report)
    return run
