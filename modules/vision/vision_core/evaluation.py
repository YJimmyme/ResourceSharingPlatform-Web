"""保留集評估的純計算：數量正確率、各品項精確率／召回率、門檻掃描與校準。

輸入 samples：[{'id':..., 'truth':[{'label','box'}], 'predictions':[{'label','box','confidence'}]}]
predictions 應以較低的 sweep_floor 取得，再由這裡依門檻過濾，避免每個門檻重跑模型。
"""
import hashlib, json
from collections import Counter, defaultdict


def test_set_fingerprint(records):
    """同一份保留集（照片與標註版本）才能互相比較模型。"""
    keys = sorted((r['id'], r.get('revision', 1)) for r in records if r['split'] == 'test')
    return hashlib.sha256(json.dumps(keys).encode()).hexdigest()[:16]


def iou(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0]); h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:return 0.0
    inter = w * h
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def match(truth, predictions, iou_threshold):
    """同品項內依信心由高到低貪婪配對。回傳 [(prediction, matched)] 與未命中的人工框數（依品項）。

    高信心框先配對，因此提高門檻只會移除尾端預測，不會改變其餘框的配對結果。
    """
    pairs = []; missed = Counter()
    for label in {b['label'] for b in truth} | {p['label'] for p in predictions}:
        free = [b['box'] for b in truth if b['label'] == label]
        for p in sorted((p for p in predictions if p['label'] == label), key=lambda p: -p['confidence']):
            best = max(range(len(free)), key=lambda i: iou(p['box'], free[i]), default=None)
            ok = best is not None and iou(p['box'], free[best]) >= iou_threshold
            if ok:free.pop(best)
            pairs.append((p, ok))
        missed[label] += len(free)
    return pairs, missed


def _ratio(a, b, empty):
    return a / b if b else empty


def summarize(samples, confidence, iou_threshold):
    rows = []; exact = 0; total_error = 0
    stats = defaultdict(lambda: {'truth': 0, 'predicted': 0, 'tp': 0, 'fp': 0, 'fn': 0})
    for s in samples:
        kept = [p for p in s['predictions'] if p['confidence'] >= confidence]
        expected = Counter(b['label'] for b in s['truth']); predicted = Counter(p['label'] for p in kept)
        same = predicted == expected; error = sum(abs(predicted[k] - expected[k]) for k in predicted.keys() | expected.keys())
        exact += same; total_error += error
        rows.append({'id': s['id'], 'expected': dict(expected), 'predicted': dict(predicted), 'exact': same, 'absoluteCountError': error})
        pairs, missed = match(s['truth'], kept, iou_threshold)
        for label, n in expected.items():stats[label]['truth'] += n
        for p, ok in pairs:
            stats[p['label']]['predicted'] += 1; stats[p['label']]['tp' if ok else 'fp'] += 1
        for label, n in missed.items():stats[label]['fn'] += n
    per_class = {label: {**v, 'precision': _ratio(v['tp'], v['tp'] + v['fp'], None), 'recall': _ratio(v['tp'], v['truth'], None)} for label, v in sorted(stats.items())}
    tp = sum(v['tp'] for v in stats.values()); fp = sum(v['fp'] for v in stats.values()); truth = sum(v['truth'] for v in stats.values())
    precision = _ratio(tp, tp + fp, 1.0 if not truth else 0.0); recall = _ratio(tp, truth, 1.0)
    return {
        'images': len(samples), 'confidence': confidence,
        'exactItemAndCountRate': _ratio(exact, len(samples), 0.0),
        'meanAbsoluteCountErrorPerImage': _ratio(total_error, len(samples), 0.0),
        'precision': precision, 'recall': recall, 'f1': _ratio(2 * precision * recall, precision + recall, 0.0),
        'perClass': per_class, 'rows': rows,
    }


def sweep(samples, iou_threshold, thresholds=None):
    thresholds = thresholds or [round(.05 * i, 2) for i in range(1, 20)]
    keys = ['confidence', 'exactItemAndCountRate', 'meanAbsoluteCountErrorPerImage', 'precision', 'recall', 'f1']
    return [{k: summarize(samples, t, iou_threshold)[k] for k in keys} for t in thresholds]


def calibrate(samples, iou_threshold, target_precision, min_samples, floor):
    """找出每個品項「門檻以上精確率 ≥ 目標」的最低門檻，供複核判斷使用。

    人工框少於 min_samples 的品項不個別校準，沿用全域門檻。
    完全達不到目標的品項回傳 0.99，代表此品項的辨識結果一律送複核。
    """
    by_class = defaultdict(list); support = Counter()
    for s in samples:
        kept = [p for p in s['predictions'] if p['confidence'] >= floor]
        pairs, _ = match(s['truth'], kept, iou_threshold)
        for p, ok in pairs:by_class[p['label']].append((p['confidence'], ok))
        support.update(b['label'] for b in s['truth'])

    def lowest(points, total):
        points = sorted(points, key=lambda x: -x[0]); best = None; tp = 0
        for i, (conf, ok) in enumerate(points, 1):
            tp += ok
            if tp / i >= target_precision:best = (conf, tp / i, _ratio(tp, total, None))
        if best is None:return {'threshold': .99, 'precision': None, 'recall': 0.0, 'reachable': False}
        return {'threshold': round(min(max(best[0], .01), .99), 4), 'precision': best[1], 'recall': best[2], 'reachable': True}

    classes = {}; skipped = {}
    for label in sorted(set(support) | set(by_class)):
        if support[label] < min_samples:skipped[label] = f'保留集僅 {support[label]} 個框，少於 {min_samples}'
        else:classes[label] = {**lowest(by_class[label], support[label]), 'support': support[label]}
    pooled = [x for v in by_class.values() for x in v]
    overall = lowest(pooled, sum(support.values())) if sum(support.values()) >= min_samples else None
    return {'targetPrecision': target_precision, 'iou': iou_threshold, 'global': overall, 'classes': classes, 'skipped': skipped}


def evaluate(samples, confidence, iou_threshold, target_precision, min_samples, floor):
    if not samples:raise ValueError('沒有保留測試集')
    report = summarize(samples, confidence, iou_threshold)
    report['iou'] = iou_threshold
    report['sweep'] = sweep(samples, iou_threshold)
    report['calibration'] = calibrate(samples, iou_threshold, target_precision, min_samples, floor)
    return report


def compare(candidate, baseline, max_rate_drop, max_error_increase):
    """發布門檻：candidate 與 baseline 須來自同一份保留集。回傳 (ok, 說明)。"""
    if candidate.get('testSetFingerprint') != baseline.get('testSetFingerprint'):
        return False, '兩個模型不是用同一份保留測試集評估，無法比較'
    rate_drop = baseline['exactItemAndCountRate'] - candidate['exactItemAndCountRate']
    error_increase = candidate['meanAbsoluteCountErrorPerImage'] - baseline['meanAbsoluteCountErrorPerImage']
    detail = (f"完全正確率 {candidate['exactItemAndCountRate']:.1%}（上線模型 {baseline['exactItemAndCountRate']:.1%}），"
              f"每張數量誤差 {candidate['meanAbsoluteCountErrorPerImage']:.2f}（上線模型 {baseline['meanAbsoluteCountErrorPerImage']:.2f}）")
    if rate_drop > max_rate_drop + 1e-9 or error_increase > max_error_increase + 1e-9:return False, '新模型表現較差：' + detail
    return True, detail
