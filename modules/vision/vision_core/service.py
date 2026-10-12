"""VisionCore：把資料集、模型、推論、工作、回饋組成單一入口，供 HTTP 層與轉接器使用。"""
import base64, threading, time
from collections import Counter
from .config import load_config
from .dataset import Dataset
from .feedback import FeedbackStore
from .inference import Detector, object_contract
from .jobs import JobManager
from .models import ModelRegistry
from .ports import NullOutcomeSource
from .storage import read_json, write_json


class VisionCore:
    def __init__(self, config=None, outcomes=None):
        self.config = config or load_config()
        self.config.model_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.dataset = Dataset(self.config.data_dir)
        self.registry = ModelRegistry(self.config)
        self.detector = Detector(self.config, self.registry)
        self.jobs = JobManager(self.config, self.dataset, self.registry); self.jobs.lock = self.lock
        self.feedback = FeedbackStore(self.config, self.dataset)
        self.outcomes = outcomes or NullOutcomeSource()

    @property
    def data(self):
        return self.config.data_dir

    # ---- 查詢 ----
    def status(self):
        with self.lock:
            rows = self.dataset.records()
            return {'classes': self.dataset.classes(), 'models': self.registry.available(),
                    'samples': [{k: v for k, v in r.items() if k != 'boxes'} | {'count': len(r['boxes'])} for r in rows],
                    'job': self.jobs.state(), 'jobs': [{'id': p.parent.name, **read_json(p)} for p in (self.data / 'runs').glob('*/state.json')],
                    'deployment': self.registry.deployment(), 'storage': str(self.data)}

    def readiness(self):
        records = self.dataset.records()
        train = [r for r in records if r['split'] == 'train' and r['boxes']]; val = [r for r in records if r['split'] == 'val' and r['boxes']]
        learned = {b['label'] for r in train for b in r['boxes']}
        missing = sorted({b['label'] for r in records if r['split'] != 'train' for b in r['boxes']} - learned)
        reasons = []
        if not train:reasons.append('先在照片標註頁保存至少一張有框的訓練照片')
        if not val:reasons.append('一般建模還需要一張不同照片作為驗證集；目前可使用單張練習')
        if missing:reasons.append('這些驗證／測試品項缺少訓練樣本：' + '、'.join(missing))
        return {'canTrain': not reasons, 'canPractice': bool(train), 'canEvaluate': any(r['split'] == 'test' for r in records), 'reasons': reasons}

    def module_info(self, production):
        with self.lock:
            return {'apiVersion': '1.0', 'production': production, 'models': self.registry.describe(), 'jobs': self.jobs.history(),
                    'readiness': self.readiness(), 'activeModel': self.registry.active(), 'config': self.public_config()}

    def public_config(self):
        """工作台顯示用的目前設定（不含路徑以外的敏感資訊）。"""
        c = self.config
        return {k: c.section(k) for k in ['inference', 'review', 'training', 'evaluation', 'release', 'improvement']}

    # ---- 類別與主系統品項對應 ----
    def catalog(self):
        mapping = read_json(self.data / 'catalog-mapping.json', {})
        return [{'classId': i, 'label': name, 'itemId': mapping.get(name)} for i, name in enumerate(self.dataset.classes())]

    def set_catalog(self, rows):
        with self.lock:
            mapping = read_json(self.data / 'catalog-mapping.json', {})
            if not isinstance(rows, list):raise ValueError('請提供 mappings 陣列')
            for r in rows:
                if not isinstance(r, dict) or r.get('label') not in self.dataset.classes():raise ValueError('先新增標註品項')
                item = r.get('itemId')
                if item is not None and (not isinstance(item, str) or not item.strip() or len(item) > 128):raise ValueError('itemId 必須是1至128字元字串或null')
                mapping[r['label']] = item
            write_json(self.data / 'catalog-mapping.json', mapping)

    # ---- 推論 ----
    def predict(self, image_data, model=None, confidence=None):
        with self.lock:
            if self.jobs.busy():raise ValueError('訓練／評估中，請完成或停止後再辨識')
        selected = model or self.registry.active(); self.registry.path(selected)
        image, raw, _ = self.dataset.decode(image_data)
        conf = float(self.config.section('inference')['predict_confidence'] if confidence is None else confidence)
        if not .01 <= conf <= .95:raise ValueError('信心門檻需介於0.01與0.95')
        start = time.time(); boxes = self.detector.infer(image, selected, conf)
        return {'boxes': boxes, 'counts': dict(Counter(x['label'] for x in boxes)), 'elapsedMs': round((time.time() - start) * 1000), 'apiVersion': '1.0',
                'model': selected, 'objects': object_contract(boxes, read_json(self.data / 'catalog-mapping.json', {})),
                'image': 'data:image/png;base64,' + base64.b64encode(raw).decode()}
