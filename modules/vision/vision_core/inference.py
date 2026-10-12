"""YOLO 推論；權重載入後快取，同一時間只跑一個推論避免 CPU 爭用。"""
import threading


class Detector:
    def __init__(self, config, registry):
        self.config = config; self.registry = registry
        self._lock = threading.Lock(); self._models = {}

    def infer(self, image, model_id='pretrained', confidence=.25):
        """回傳 [{'label','box':[左,上,右,下] 0–1,'confidence'}]。"""
        path = self.registry.path(model_id); settings = self.config.section('inference')
        with self._lock:
            from ultralytics import YOLO
            if str(path) not in self._models:self._models[str(path)] = YOLO(str(path))
            result = self._models[str(path)].predict(image, conf=confidence, imgsz=settings['imgsz'], device=settings['device'], verbose=False)[0]
            return [{'label': result.names[int(cls)], 'box': xy, 'confidence': float(c)}
                    for xy, cls, c in zip(result.boxes.xyxyn.tolist(), result.boxes.cls.tolist(), result.boxes.conf.tolist())]

    def clear(self):
        self._models.clear()


def object_contract(boxes, mapping):
    """對外契約格式：bbox 取代 box，並附上主系統品項 ID（未對應為 None）。"""
    return [{'itemId': mapping.get(b['label']), 'label': b['label'], 'bbox': b['box'], 'confidence': b['confidence']} for b in boxes]
