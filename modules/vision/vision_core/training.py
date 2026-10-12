"""獨立訓練/保留集評估子程序，使用已保存的不可變資料快照。

執行方式：python -m vision_core.training <runs/工作ID>（由 jobs.JobManager 啟動）
"""
import sys
from pathlib import Path
from .evaluation import evaluate, test_set_fingerprint
from .storage import now, read_json, write_json

# 舊版工作設定沒有這些鍵時，沿用當時寫死的數值
TRAIN_DEFAULTS = {'imgsz': 640, 'batch': 2, 'workers': 0, 'seed': 42, 'amp': False, 'patience': 100, 'augment': {}}
EVAL_DEFAULTS = {'sweep_floor': .05, 'iou_match': .5, 'target_precision': .9, 'min_samples_per_class': 5, 'imgsz': 640}


def train(model, run, config, practice):
    params = {**TRAIN_DEFAULTS, **config.get('train', {})}

    def progress(trainer):
        write_json(run / 'state.json', {'status': 'running', 'mode': 'train', 'practiceOnly': practice, 'epoch': trainer.epoch + 1, 'epochs': config['epochs']})
    model.add_callback('on_train_epoch_end', progress)
    result = model.train(data=str(run / 'local-data.yaml'), epochs=config['epochs'], imgsz=params['imgsz'], batch=params['batch'], workers=params['workers'],
                         device=config['device'], project=str(run), name='train', exist_ok=False, seed=params['seed'], plots=True, amp=params['amp'],
                         patience=params['patience'], val=not practice, **params['augment'])
    write_json(run / 'state.json', {'status': 'completed', 'mode': 'train', 'practiceOnly': practice, 'validationIndependent': not practice,
                                    'warning': '單張練習：無獨立驗證資料，訓練輸出的同圖分數不代表真實準確率' if practice else '',
                                    'metrics': None if practice else {k: float(v) for k, v in result.results_dict.items()},
                                    'weights': str(run / 'train/weights/best.pt'), 'finished': now()})


def run_evaluation(model, run, config, snapshot, manifest):
    settings = {**EVAL_DEFAULTS, **config.get('evaluation', {})}
    floor = min(settings['sweep_floor'], config.get('confidence', .15))
    samples = []
    for r in manifest['records']:
        if r['split'] != 'test':continue
        result = model.predict(str(snapshot / 'images/test' / f"{r['id']}.png"), conf=floor, imgsz=settings['imgsz'], device=config['device'], verbose=False)[0]
        predictions = [{'label': result.names[int(c)], 'box': xy, 'confidence': float(p)}
                       for xy, c, p in zip(result.boxes.xyxyn.tolist(), result.boxes.cls.tolist(), result.boxes.conf.tolist())]
        samples.append({'id': r['id'], 'truth': r['boxes'], 'predictions': predictions})
    report = evaluate(samples, config.get('confidence', .15), settings['iou_match'], settings['target_precision'], settings['min_samples_per_class'], floor)
    report['testSetFingerprint'] = test_set_fingerprint(manifest['records']); report['modelId'] = config.get('modelId')
    write_json(run / 'evaluation.json', report)
    write_json(run / 'state.json', {'status': 'completed', 'mode': 'evaluate', 'evaluation': {k: v for k, v in report.items() if k != 'rows'}, 'finished': now()})


def main():
    run = Path(sys.argv[1]); config = read_json(run / 'config.json'); snapshot = Path(config['dataset']); manifest = read_json(snapshot / 'manifest.json')
    practice = config.get('practiceOnly', False)
    write_json(run / 'state.json', {'status': 'running', 'mode': config['mode'], 'practiceOnly': practice, 'started': now()})
    try:
        from ultralytics import YOLO
        import torch
        if config['device'] == '0' and not torch.cuda.is_available():raise ValueError('目前PyTorch未啟用CUDA，請改用CPU')
        data = read_json(snapshot / 'data.yaml'); data['path'] = str(snapshot); write_json(run / 'local-data.yaml', data)
        model = YOLO(config['model'])
        if config['mode'] == 'train':train(model, run, config, practice)
        else:run_evaluation(model, run, config, snapshot, manifest)
    except Exception as e:
        write_json(run / 'state.json', {'status': 'failed', 'error': str(e)}); raise


if __name__ == '__main__':main()
