"""讀取 config/vision.yaml，套用環境變數覆寫；缺少的鍵使用與舊版行為相同的預設值。"""
import copy, math, os
from pathlib import Path

MODULE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FILE = MODULE_ROOT / 'config' / 'vision.yaml'

DEFAULTS = {
    'inference': {'pretrained_weights': 'yolo11n.pt', 'imgsz': 640, 'device': 'cpu', 'predict_confidence': .25, 'recognition_confidence': .15},
    'review': {'threshold': .65, 'use_calibrated_thresholds': True, 'target_precision': .9, 'min_samples_per_class': 5},
    'catalog': {'auto_sync_classes': True},
    'training': {'default_epochs': 30, 'max_epochs': 300, 'imgsz': 640, 'batch': 2, 'workers': 0, 'seed': 42, 'amp': False, 'patience': 100, 'augment': {}},
    'evaluation': {'confidence': .15, 'sweep_floor': .05, 'iou_match': .5},
    'improvement': {'min_train_boxes': 30, 'min_test_boxes': 5, 'weak_recall': .7, 'weak_precision': .7},
    'release': {'regression_gate': True, 'max_exact_rate_drop': 0.0, 'max_count_error_increase': 0.0},
}


def _merge(base, override):
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(base.get(key), dict) and key != 'augment':base[key] = _merge(base[key], value)
        else:base[key] = value
    return base


class VisionConfig:
    """設定值的唯讀包裝：cfg.section('review')['threshold']，另提供 data_dir、model_dir。"""
    def __init__(self, values, data_dir, model_dir):
        self.values = values; self.data_dir = Path(data_dir).resolve(); self.model_dir = Path(model_dir).resolve()

    def section(self, name):
        return self.values[name]

    @property
    def pretrained_path(self):
        return self.model_dir / self.values['inference']['pretrained_weights']


def load_config(path=None, env=None, overrides=None):
    env = os.environ if env is None else env
    values = copy.deepcopy(DEFAULTS)
    source = Path(path) if path else Path(env.get('VISION_CONFIG', DEFAULT_FILE))
    if source.exists():
        import yaml
        _merge(values, yaml.safe_load(source.read_text(encoding='utf-8')) or {})
    if env.get('YOLO_INFERENCE_DEVICE'):values['inference']['device'] = env['YOLO_INFERENCE_DEVICE']
    if env.get('YOLO_REVIEW_THRESHOLD'):values['review']['threshold'] = float(env['YOLO_REVIEW_THRESHOLD'])
    _merge(values, overrides)
    threshold = values['review']['threshold']
    if not isinstance(threshold, (int, float)) or not math.isfinite(threshold) or not 0 < threshold < 1:raise ValueError('YOLO_REVIEW_THRESHOLD must be between 0 and 1')
    data_dir = env.get('VISION_DATA_DIR') or env.get('YOLO_LAB_DATA') or MODULE_ROOT / 'data'
    model_dir = env.get('VISION_MODEL_DIR') or MODULE_ROOT / 'models'
    return VisionConfig(values, data_dir, model_dir)
