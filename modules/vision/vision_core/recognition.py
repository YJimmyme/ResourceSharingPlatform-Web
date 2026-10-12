"""正式辨識流程：YOLO 優先 → 目錄標準化 → 必要時雲端複核 → 保存回饋 → 寫入主系統。

主系統相關的動作（讀照片、讀目錄、寫待確認紀錄、雲端複核）全部透過 ports 注入。
"""
import base64, logging
from .errors import VisionError
from .policy import canonical_boxes, fallback_reasons, grouped_items
from .storage import read_json, write_json

log = logging.getLogger(__name__)


class RecognitionService:
    def __init__(self, core, catalog, images, sink, reviewer=None):
        self.core = core; self.catalog = catalog; self.images = images; self.sink = sink; self.reviewer = reviewer

    def _sync_catalog(self, catalog):
        """主系統目錄品項加入標註類別，並以品項 ID 建立類別對應；回傳對應表。"""
        core = self.core; path = core.config.data_dir / 'catalog-mapping.json'
        with core.lock:
            mapping = read_json(path, {})
            if core.config.section('catalog')['auto_sync_classes']:
                for d in catalog:
                    core.dataset.add_class(d['item_name'])
                    if d.get('id') is not None and d['item_name'] not in mapping:mapping[d['item_name']] = str(d['id'])
                write_json(path, mapping)
            return mapping

    def _detect(self, image, model_id, catalog, synonyms, mapping):
        raw = self.core.detector.infer(image, model_id, self.core.config.section('inference')['recognition_confidence'])
        by_id = {str(d['id']): d for d in catalog if d.get('id') is not None}
        for box in raw:
            match = by_id.get(mapping.get(box['label']))
            if match:box['label'] = match['item_name']
        return canonical_boxes(raw, catalog, synonyms)

    def recognize(self, actor, body):
        core = self.core; location = body.get('locationId')
        if type(location) != int or location <= 0:raise VisionError('請選據點')
        if not actor.is_admin and actor.location_id != location:raise VisionError('只能在所屬據點辨識', 403)
        content = self.images.fetch(actor, body.get('imagePath', ''))
        image, raw, image_id = core.dataset.decode('data:image/png;base64,' + base64.b64encode(content).decode())
        catalog = self.catalog.items(); synonyms = self.catalog.synonyms()
        mapping = self._sync_catalog(catalog)
        with core.lock:
            selected = core.registry.active(); core.registry.path(selected)
        threshold = core.config.section('review')['threshold']; class_thresholds = core.registry.review_thresholds()
        audit = {'model': selected, 'imagePath': body.get('imagePath'), 'complexity': body.get('complexity', 'simple')}; warnings = []
        try:
            boxes = self._detect(image, selected, catalog, synonyms, mapping)
        except Exception:
            log.exception('YOLO inference failed'); boxes = []; warnings.append('YOLO執行失敗')
        audit['yolo_boxes'] = boxes
        reasons = fallback_reasons(boxes, catalog, threshold, body.get('forceReview') is True, class_thresholds)
        provider = 'yolo'; uncertain = False
        if reasons:
            try:
                if self.reviewer is None:raise VisionError('未設定雲端複核，請人工核對')
                parsed, provider_audit = self.reviewer.review(image, boxes, catalog, body.get('complexity'))
                boxes = canonical_boxes(parsed['objects'], catalog, synonyms)
                provider = provider_audit.get('provider', 'review'); audit[provider] = provider_audit; uncertain = bool(parsed.get('needs_review'))
                unresolved = fallback_reasons(boxes, catalog, threshold)
                if unresolved:uncertain = True; warnings.extend(['複核後仍需人工確認：' + x for x in unresolved])
                if parsed.get('uncertainty'):warnings.append(str(parsed['uncertainty'])[:1000])
            except Exception as e:
                warnings.append(str(e) if isinstance(e, (VisionError, ValueError)) else '雲端複核無法完成，請人工核對'); uncertain = True
        items = grouped_items(boxes)
        with core.lock:
            record = core.feedback.create(actor, location, raw, image_id, audit, boxes, provider, reasons, warnings)
        result = {'feedbackId': record['id'], 'provider': provider, 'items': items, 'uncertain': uncertain, 'catalog': catalog}
        logs = self.sink.write(actor, body, result) if items else []
        with core.lock:
            core.feedback.attach_logs(record, [x['id'] for x in logs])
        image_url = 'data:image/png;base64,' + base64.b64encode(raw).decode()
        return {'success': True, 'logs': logs, 'message': '辨識完成，請核對品項及可見數量', 'requires_review': True,
                'feedback': {'id': record['id'], 'image': image_url, 'boxes': boxes, 'provider': provider, 'warnings': warnings, 'reasons': reasons}}
