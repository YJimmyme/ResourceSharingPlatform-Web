"""模型清單、命名、評估紀錄與發布（deployment.json）。"""
from .errors import VisionError
from .evaluation import compare
from .storage import now, read_json, write_json

PRETRAINED = 'pretrained'


class ModelRegistry:
    def __init__(self, config):
        self.config = config; self.data = config.data_dir

    # ---- 清單 ----
    def available(self):
        result = [{'id': PRETRAINED, 'label': 'YOLO11n 通用預訓練（非專屬品項）'}]
        for p in sorted((self.data / 'runs').glob('*/train/weights/best.pt')):
            run = p.parents[2]
            if read_json(run / 'state.json', {}).get('status') != 'completed':continue
            practice = read_json(run / 'config.json', {}).get('practiceOnly')
            result.append({'id': run.name, 'label': ('練習模型（無獨立驗證） ' if practice else '專屬模型 ') + run.name})
        return result

    def path(self, id):
        if id == PRETRAINED:return self.config.pretrained_path
        if id not in [m['id'] for m in self.available()]:raise ValueError('請選擇已訓練的模型')
        return self.data / 'runs' / id / 'train' / 'weights' / 'best.pt'

    def _matches(self, run_config, id):
        if run_config.get('modelId'):return run_config['modelId'] == id
        return run_config.get('model') == str(self.path(id))

    def evaluations(self, id):
        """此模型所有完成的保留集評估，新到舊。"""
        found = []
        for p in (self.data / 'runs').glob('*/state.json'):
            state = read_json(p, {})
            if state.get('status') != 'completed' or state.get('mode') != 'evaluate':continue
            if not self._matches(read_json(p.parent / 'config.json', {}), id):continue
            report = read_json(p.parent / 'evaluation.json') or state.get('evaluation') or {}
            found.append({'run': p.parent.name, 'finished': state.get('finished', ''), **report})
        return sorted(found, key=lambda r: r['finished'], reverse=True)

    def describe(self):
        names = read_json(self.data / 'model-names.json', {}); rows = []
        for m in self.available():
            config = read_json(self.data / 'runs' / m['id'] / 'config.json', {})
            latest = next(iter(self.evaluations(m['id'])), None)
            summary = None if not latest else {k: latest.get(k) for k in ['run', 'finished', 'images', 'exactItemAndCountRate', 'meanAbsoluteCountErrorPerImage', 'precision', 'recall', 'testSetFingerprint']}
            rows.append({**m, 'name': names.get(m['id']) or config.get('displayName') or m['label'], 'practiceOnly': config.get('practiceOnly', False),
                         'created': config.get('created'), 'evaluated': latest is not None, 'evaluation': summary,
                         'canActivate': m['id'] == PRETRAINED or (latest is not None and not config.get('practiceOnly', False))})
        return rows

    def rename(self, id, name):
        self.path(id); name = str(name or '').strip()
        if not name or len(name) > 60:raise ValueError('模型名稱需為1至60字')
        if id == PRETRAINED:raise ValueError('通用模型名稱固定')
        names = read_json(self.data / 'model-names.json', {}); names[id] = name; write_json(self.data / 'model-names.json', names)

    # ---- 發布 ----
    def deployment(self):
        return read_json(self.data / 'deployment.json', {'model': PRETRAINED})

    def active(self):
        return self.deployment()['model']

    def review_thresholds(self):
        """目前上線模型依評估校準的各品項複核門檻；未校準的品項沿用設定檔門檻。"""
        return self.deployment().get('reviewThresholds', {})

    def activate(self, id, operator='local'):
        self.path(id); release = self.config.section('release'); note = ''
        current = self.deployment(); history = current.get('history', [])
        candidate = None
        if id != PRETRAINED:
            config = read_json(self.data / 'runs' / id / 'config.json', {})
            if config.get('practiceOnly'):raise ValueError('單張練習模型不能發布，請以一般模式及獨立驗證資料重新訓練')
            state = read_json(self.data / 'runs' / id / 'state.json', {})
            if state.get('status') != 'completed' or state.get('mode') != 'train':raise ValueError('僅可啟用完成訓練的模型')
            evaluations = self.evaluations(id)
            if not evaluations:raise ValueError('請先完成此模型的保留集評估，再啟用')
            candidate = evaluations[0]
            rollback = id in {h.get('model') for h in history}
            if release['regression_gate'] and id != current['model'] and not rollback:
                note = self._gate(candidate, current['model'], release)
            elif rollback:note = '回復先前發布過的模型，略過退步檢查'
        record = {'model': id, 'updated': now(), 'operator': operator, 'note': note,
                  'history': history + [{'model': current['model'], 'changed': now()}]}
        calibration = (candidate or {}).get('calibration')
        if calibration and self.config.section('review')['use_calibrated_thresholds']:
            record['reviewThresholds'] = {label: c['threshold'] for label, c in calibration['classes'].items()}
            if calibration.get('global'):record['calibratedGlobal'] = calibration['global']  # 僅供參考，全域門檻仍以設定檔為準
        write_json(self.data / 'deployment.json', record)
        return record

    def _gate(self, candidate, current_id, release):
        if not candidate.get('testSetFingerprint'):raise VisionError('此模型的評估是舊版格式，請重新執行保留集評估後再啟用')
        baseline = next((e for e in self.evaluations(current_id) if e.get('testSetFingerprint') == candidate['testSetFingerprint']), None)
        if baseline is None:
            raise VisionError('請先用同一份保留測試集評估目前上線模型（' + current_id + '），系統需比較兩者確認新模型沒有退步')
        ok, detail = compare(candidate, baseline, release['max_exact_rate_drop'], release['max_count_error_increase'])
        if not ok:raise VisionError(detail + '。若仍要發布，請調整 config/vision.yaml 的 release 設定')
        return detail
