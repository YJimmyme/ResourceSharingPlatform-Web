"""辨識回饋：每次正式辨識保存原圖與結果，使用者修正後由管理員審核才納入資料集。"""
import base64, uuid
from collections import Counter
from .errors import VisionError
from .policy import canonical_boxes
from .storage import now, read_json, write_json


def priority(record):
    """越值得優先審核的回饋分數越高：模型失手、數量或品項被大幅修正的案例最能改善模型。"""
    score = 0; why = []; reasons = record.get('reasons') or []
    if record.get('provider') != 'yolo':score += 3; why.append('YOLO 結果未被採用')
    if 'YOLO未找到物件' in reasons:score += 3; why.append('YOLO 沒找到物件')
    if '辨識品項不在標準目錄' in reasons:score += 2; why.append('品項不在目錄')
    if '部分物件信心低於設定門檻' in reasons:score += 1; why.append('信心偏低')
    if record.get('reviewed'):
        predicted = Counter(b['label'] for b in (record.get('audit') or {}).get('yolo_boxes', []))
        corrected = Counter(b['label'] for b in record.get('corrected_boxes', []))
        diff = sum(abs(predicted[k] - corrected[k]) for k in predicted.keys() | corrected.keys())
        if diff:score += 2 * diff; why.append(f'修正後數量差 {diff}')
        if set(predicted) != set(corrected):score += 2; why.append('品項被更改')
    return score, why


class FeedbackStore:
    def __init__(self, config, dataset):
        self.root = config.data_dir / 'feedback'; self.root.mkdir(parents=True, exist_ok=True); self.ds = dataset

    @staticmethod
    def authorize(actor, record):
        if actor.is_admin:return
        if actor.location_id != record['locationId']:raise VisionError('只能在所屬據點辨識', 403)
        if record['owner'] != actor.id:raise VisionError('只能修正自己的辨識紀錄', 403)

    def get(self, id):
        if not isinstance(id, str) or len(id) != 32 or any(c not in '0123456789abcdef' for c in id):raise VisionError('無效回饋ID')
        r = read_json(self.root / (id + '.json'))
        if not r:raise VisionError('找不到辨識紀錄', 404)
        return r

    def create(self, actor, location_id, raw_png, image_id, audit, boxes, provider, reasons, warnings):
        id = uuid.uuid4().hex
        record = {'id': id, 'owner': actor.id, 'locationId': location_id, 'image_id': image_id, 'created': now(), 'audit': audit,
                  'boxes': boxes, 'provider': provider, 'reasons': reasons, 'warnings': warnings, 'reviewed': False}
        (self.root / (id + '.png')).write_bytes(raw_png); write_json(self.root / (id + '.json'), record)
        return record

    def attach_logs(self, record, log_ids):
        record['log_ids'] = log_ids; write_json(self.root / (record['id'] + '.json'), record)

    def submit(self, actor, id, boxes, reviewed, negative, note):
        r = self.get(id); self.authorize(actor, r)
        if reviewed is not True:raise VisionError('請確認框選與品項已核對')
        boxes = canonical_boxes(boxes if boxes is not None else [], [], [])
        if not boxes and negative is not True:raise VisionError('空場景請明確確認')
        if any(x['label'] not in self.ds.classes() for x in boxes):raise VisionError('請先由管理員新增目錄品項')
        history = self.root / 'history'; history.mkdir(exist_ok=True); write_json(history / (r['id'] + '-' + uuid.uuid4().hex + '.json'), r)
        r.update({'corrected_boxes': boxes, 'reviewed': True, 'reviewed_by': actor.id, 'reviewed_at': now(), 'note': str(note or '')[:2000], 'approved': False})
        write_json(self.root / (r['id'] + '.json'), r)
        return r

    def rows(self):
        result = []
        for p in self.root.glob('*.json'):
            r = read_json(p); score, why = priority(r)
            result.append({**{k: r.get(k) for k in ['id', 'created', 'reviewed', 'approved', 'provider', 'locationId', 'note']}, 'priority': score, 'priorityReasons': why})
        # 待處理且分數高的排前面
        return sorted(result, key=lambda r: (bool(r['approved']), -r['priority'], r['created'] or ''), reverse=False)

    def approve(self, actor, id, split='train', group=None):
        r = self.get(id)
        if not r.get('reviewed'):raise VisionError('尚未人工核對')
        if r.get('approved'):raise VisionError('已納入資料集，請由資料清單修正')
        data = {'image': 'data:image/png;base64,' + base64.b64encode((self.root / (r['id'] + '.png')).read_bytes()).decode(), 'filename': 'feedback-' + r['id'] + '.png',
                'boxes': r['corrected_boxes'], 'split': split, 'group': group or r['image_id'], 'reviewed': True, 'negative': not r['corrected_boxes'], 'note': r.get('note', '')}
        saved = self.ds.save(data)
        r['approved'] = True; r['approved_by'] = actor.id; r['dataset_id'] = saved['id']; write_json(self.root / (r['id'] + '.json'), r)
        return saved

    def detail(self, id):
        r = self.get(id)
        return r, 'data:image/png;base64,' + base64.b64encode((self.root / (id + '.png')).read_bytes()).decode()

    def all(self):
        return [read_json(p) for p in self.root.glob('*.json')]
