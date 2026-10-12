"""YOLO結果標準化與複核觸發；純函式便於隔離測試。"""
import math
from collections import Counter

def normalized_name(s):return ''.join(str(s).lower().split())
def canonical_boxes(boxes,catalog,synonyms):
    if not isinstance(boxes,list) or len(boxes)>500:raise ValueError('物件框必須是500筆以內的陣列')
    names={normalized_name(d['item_name']):d['item_name'] for d in catalog}
    alias={normalized_name(s['synonym']):s['standard_name'] for s in synonyms}
    result=[]
    for b in boxes:
        if not isinstance(b,dict):raise ValueError('無效物件框')
        label=str(b.get('label','')).strip();coords=b.get('box')
        if not label or not isinstance(coords,list) or len(coords)!=4 or any(type(v) not in (int,float) or not math.isfinite(v) for v in coords):raise ValueError('辨識回覆包含無效物件框')
        if not 0<=coords[0]<coords[2]<=1 or not 0<=coords[1]<coords[3]<=1:raise ValueError('辨識回覆的物件框超出圖片')
        label=alias.get(normalized_name(label),names.get(normalized_name(label),label))
        conf=b.get('confidence');conf=float(conf) if type(conf) in (int,float) and math.isfinite(conf) else 0
        result.append({'label':label,'box':coords,'confidence':max(0,min(1,conf))})
    return result

def fallback_reasons(boxes,catalog,threshold,force=False,class_thresholds=None):
    """class_thresholds：啟用模型時依評估校準的各品項門檻；未列出的品項使用 threshold。"""
    reasons=[];names={d['item_name'] for d in catalog};per_class=class_thresholds or {}
    if force:reasons.append('使用者要求重新複核')
    if not boxes:reasons.append('YOLO未找到物件')
    if any(b['confidence']<per_class.get(b['label'],threshold) for b in boxes):reasons.append('部分物件信心低於設定門檻')
    if any(b['label'] not in names for b in boxes):reasons.append('辨識品項不在標準目錄')
    return reasons

def grouped_items(boxes):
    return [{'name':name,'quantity':count,'confidence':min(b['confidence'] for b in boxes if b['label']==name)} for name,count in Counter(b['label'] for b in boxes).items()]
