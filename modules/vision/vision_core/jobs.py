"""訓練／評估工作管理。每個工作在獨立子程序執行，設定與資料快照寫入 runs/<id>/ 以便重現。"""
import subprocess, sys, threading, uuid
from .config import MODULE_ROOT
from .storage import now, read_json, write_json

RUNNING = ['starting', 'running', 'finishing']


class JobManager:
    def __init__(self, config, dataset, registry):
        self.config = config; self.data = config.data_dir; self.ds = dataset; self.registry = registry
        self.lock = threading.RLock(); self.active = None

    def recover(self):
        """服務重啟時把未完成的工作標成中斷；只能在取得資料鎖之後呼叫。"""
        for previous in (self.data / 'runs').glob('*/state.json'):
            state = read_json(previous, {})
            if state.get('status') in RUNNING:write_json(previous, {**state, 'status': 'interrupted', 'error': '服務曾重新啟動，請重新執行此工作'})

    def busy(self):
        return bool(self.active and self.active['process'].poll() is None)

    def state(self):
        if not self.active:return None
        run = self.data / 'runs' / self.active['id']; process = self.active['process']
        state = read_json(run / 'state.json', {'status': 'starting'})
        if process.poll() is None and state['status'] == 'completed':state['status'] = 'finishing'
        if process.poll() is not None and state['status'] in ['starting', 'running']:
            state['status'] = 'failed'; state['error'] = '子程序結束，請查看執行紀錄'; write_json(run / 'state.json', state)
        state['id'] = self.active['id']
        log = run / 'console.log'
        state['log'] = log.read_text(encoding='utf-8', errors='replace')[-7000:] if log.exists() else ''
        return state

    def history(self):
        rows = []
        for p in sorted((self.data / 'runs').glob('*/state.json'), key=lambda p: p.stat().st_mtime, reverse=True):
            rows.append({'id': p.parent.name, **read_json(p), 'name': read_json(p.parent / 'config.json', {}).get('displayName', '')})
        return rows

    def start(self, body):
        training = self.config.section('training'); evaluation = self.config.section('evaluation'); review = self.config.section('review')
        with self.lock:
            if self.busy():raise ValueError('已有執行中的工作')
            mode = body.get('mode', 'train'); model_id = body.get('model', 'pretrained'); path = self.registry.path(model_id)
            if mode not in ['train', 'evaluate']:raise ValueError('未知工作')
            epochs = int(body.get('epochs', training['default_epochs']))
            if not 1 <= epochs <= training['max_epochs']:raise ValueError(f"輪數需介於1至{training['max_epochs']}")
            if mode == 'evaluate' and not any(r['split'] == 'test' for r in self.ds.records()):raise ValueError('先保存保留測試集照片')
            practice = body.get('practiceOnly') is True
            if practice and mode != 'train':raise ValueError('單張練習不能作為保留集評估')
            practice_id = body.get('practiceSample') if practice else None
            if practice and not practice_id:raise ValueError('請選擇單張練習照片')
            device = body.get('device', self.config.section('inference')['device'])
            if device not in ['cpu', '0']:raise ValueError('裝置僅支援CPU或GPU 0')
            snapshot, directory = self.ds.export(require_training=mode == 'train', practice_id=practice_id)
            id = uuid.uuid4().hex[:12]; run = self.data / 'runs' / id; run.mkdir()
            config = {'displayName': str(body.get('displayName', '')).strip()[:60], 'practiceOnly': practice, 'practiceSample': practice_id,
                      'mode': mode, 'modelId': model_id, 'model': str(path), 'dataset': str(directory), 'epochs': epochs, 'device': device,
                      'confidence': evaluation['confidence'], 'created': now(),
                      # 超參數寫入工作設定，日後設定檔改變也能知道這個模型是怎麼訓練出來的
                      'train': {k: training[k] for k in ['imgsz', 'batch', 'workers', 'seed', 'amp', 'patience', 'augment']},
                      'evaluation': {**evaluation, 'target_precision': review['target_precision'], 'min_samples_per_class': review['min_samples_per_class'],
                                     'imgsz': self.config.section('inference')['imgsz']}}
            write_json(run / 'config.json', config)
            write_json(run / 'state.json', {'status': 'starting', 'snapshot': snapshot, 'mode': mode, 'practiceOnly': practice})
            with open(run / 'console.log', 'w', encoding='utf-8') as log:
                process = subprocess.Popen([sys.executable, '-m', 'vision_core.training', str(run)], cwd=str(MODULE_ROOT), stdout=log, stderr=subprocess.STDOUT,
                                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            self.active = {'id': id, 'process': process}
            return id

    def stop(self):
        with self.lock:
            if self.busy():
                self.active['process'].terminate(); self.active['process'].wait(timeout=15)
                write_json(self.data / 'runs' / self.active['id'] / 'state.json', {'status': 'stopped'})
