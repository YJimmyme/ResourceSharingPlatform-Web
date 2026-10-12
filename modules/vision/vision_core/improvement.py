"""改善建議：彙整資料量、回饋、上線模型評估與實際入庫結果，指出下一步該補哪些照片。"""
from collections import Counter, defaultdict


def summary(core, outcome_source=None):
    settings = core.config.section('improvement')
    records = core.dataset.records(); classes = core.dataset.classes()
    boxes = defaultdict(Counter); images = defaultdict(Counter)
    for r in records:
        for b in r['boxes']:boxes[r['split']][b['label']] += 1
        for label in {b['label'] for b in r['boxes']}:images[r['split']][label] += 1
    feedback = core.feedback.all()
    corrected = Counter(b['label'] for f in feedback if f.get('reviewed') for b in f.get('corrected_boxes', []))
    missed = Counter(); reasons = Counter(); providers = Counter()
    for f in feedback:
        reasons.update(f.get('reasons') or []); providers[f.get('provider')] += 1
        if f.get('reviewed'):
            predicted = Counter(b['label'] for b in f.get('audit', {}).get('yolo_boxes', []))
            for label, n in Counter(b['label'] for b in f.get('corrected_boxes', [])).items():missed[label] += max(0, n - predicted[label])
    active = core.registry.active(); evaluation = next(iter(core.registry.evaluations(active)), None)
    per_class = (evaluation or {}).get('perClass', {})
    relevant = sorted({*boxes['train'], *boxes['val'], *boxes['test'], *corrected, *per_class})
    rows = []
    for label in relevant:
        m = per_class.get(label, {})
        rows.append({'label': label, 'trainBoxes': boxes['train'][label], 'valBoxes': boxes['val'][label], 'testBoxes': boxes['test'][label],
                     'trainImages': images['train'][label], 'feedbackBoxes': corrected[label], 'missedByYolo': missed[label],
                     'precision': m.get('precision'), 'recall': m.get('recall')})
    suggestions = []
    for row in rows:
        if row['trainBoxes'] < settings['min_train_boxes']:
            suggestions.append({'label': row['label'], 'priority': 3 if row['trainBoxes'] == 0 else 2,
                                'text': f"「{row['label']}」訓練框 {row['trainBoxes']} 個，建議至少 {settings['min_train_boxes']} 個（不同角度、光線、背景）"})
        if row['testBoxes'] < settings['min_test_boxes']:
            suggestions.append({'label': row['label'], 'priority': 1, 'text': f"「{row['label']}」保留測試框 {row['testBoxes']} 個，少於 {settings['min_test_boxes']} 個時評估與門檻校準不可靠"})
        if row['recall'] is not None and row['recall'] < settings['weak_recall']:
            suggestions.append({'label': row['label'], 'priority': 3, 'text': f"上線模型對「{row['label']}」召回率 {row['recall']:.0%}，漏判多，請補拍此品項"})
        if row['precision'] is not None and row['precision'] < settings['weak_precision']:
            suggestions.append({'label': row['label'], 'priority': 2, 'text': f"上線模型對「{row['label']}」精確率 {row['precision']:.0%}，誤判多，請補充容易混淆的其他物品與空場景"})
        if row['missedByYolo']:
            suggestions.append({'label': row['label'], 'priority': 2, 'text': f"回饋顯示 YOLO 漏掉「{row['label']}」{row['missedByYolo']} 個，審核這些回饋並納入訓練集"})
    if not any(r.get('negative') for r in records):
        suggestions.append({'label': None, 'priority': 1, 'text': '資料集沒有空場景／負樣本，建議加入幾張沒有目標物品的倉庫照片，減少誤判'})
    outcome_source = outcome_source or core.outcomes
    return {
        'dataset': {'images': Counter(r['split'] for r in records), 'classes': len(classes), 'labeledClasses': len({*boxes['train'], *boxes['val'], *boxes['test']}),
                    'negatives': sum(1 for r in records if r.get('negative'))},
        'feedback': {'total': len(feedback), 'pendingCorrection': sum(1 for f in feedback if not f.get('reviewed')),
                     'awaitingApproval': sum(1 for f in feedback if f.get('reviewed') and not f.get('approved')),
                     'approved': sum(1 for f in feedback if f.get('approved')), 'providers': dict(providers), 'reviewReasons': dict(reasons)},
        'activeModel': {'id': active, 'evaluation': None if not evaluation else {k: evaluation.get(k) for k in ['finished', 'images', 'exactItemAndCountRate', 'meanAbsoluteCountErrorPerImage', 'precision', 'recall']},
                        'reviewThresholds': core.registry.review_thresholds()},
        'outcomes': {'configured': bool(getattr(outcome_source, 'configured', False))},
        'classes': rows,
        'suggestions': sorted(suggestions, key=lambda s: -s['priority']),
    }
