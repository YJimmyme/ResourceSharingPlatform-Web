"""本機標註資料與不可變訓練快照；不依賴 YOLO 即可測試。"""
import base64, hashlib, io, math, shutil, uuid, zipfile
from pathlib import Path
from PIL import Image, ImageOps
from .storage import now, write_json, read_json

class Dataset:
    def __init__(self,root):
        self.root=Path(root); self.root.mkdir(parents=True,exist_ok=True)
        for d in ['images','records','history','exports','runs']: (self.root/d).mkdir(exist_ok=True)
        if not (self.root/'classes.json').exists():write_json(self.root/'classes.json',[])
    def classes(self):return read_json(self.root/'classes.json')
    def add_class(self,name):
        name=str(name).strip()
        if not name or len(name)>60:raise ValueError('品項名稱需為1至60字')
        classes=self.classes()
        if name not in classes:classes.append(name);write_json(self.root/'classes.json',classes)
        return classes
    def decode(self,data):
        if not isinstance(data,str) or not data.startswith('data:image/'):raise ValueError('請選擇照片')
        raw=base64.b64decode(data.split(',',1)[1],validate=True)
        if len(raw)>48*1024*1024:raise ValueError('處理後圖片上限48MB，請縮小照片')
        with Image.open(io.BytesIO(raw)) as original:
            if original.width*original.height>40000000:raise ValueError('照片像素上限4000萬')
            im=ImageOps.exif_transpose(original).convert('RGB')
        output=io.BytesIO();im.save(output,format='PNG');raw=output.getvalue()
        if len(raw)>48*1024*1024:raise ValueError('處理後圖片上限48MB，請縮小照片')
        return im,raw,hashlib.sha256(raw).hexdigest()
    def records(self):return [read_json(p) for p in sorted((self.root/'records').glob('*.json'))]
    def record(self,id):
        if not isinstance(id,str) or len(id)!=64 or any(c not in '0123456789abcdef' for c in id):raise ValueError('無效圖片ID')
        result=read_json(self.root/'records'/f'{id}.json')
        if not result:raise ValueError('找不到照片')
        return result
    def save(self,b):
        im,raw,id=self.decode(b.get('image'));old=read_json(self.root/'records'/f'{id}.json')
        if b.get('reviewed') is not True:raise ValueError('請先勾選人工核對完成')
        split=b.get('split');group=str(b.get('group') or id).strip()[:100]
        if split not in ['train','val','test']:raise ValueError('請選資料用途')
        if old and old['split']!=split:raise ValueError('同圖已在其他集合，禁止跨集合重複使用')
        if old and old['group']!=group:raise ValueError('已保存圖片的拍攝群組不可更換')
        if any(r['group']==group and r['split']!=split for r in self.records()):raise ValueError('同拍攝群組需使用相同集合，避免相似照片洩漏')
        boxes=b.get('boxes');classes=self.classes()
        if not isinstance(boxes,list) or len(boxes)>500:raise ValueError('無效標註')
        if not boxes and b.get('negative') is not True:raise ValueError('無框照片請確認「這是空場景／負樣本」')
        clean=[]
        for x in boxes:
            label=x.get('label');coords=x.get('box')
            if label not in classes:raise ValueError(f'品項「{label}」尚未加入專屬目錄，請改標或新增品項')
            if not isinstance(coords,list) or len(coords)!=4 or any(type(v) not in (int,float) or not math.isfinite(v) for v in coords):raise ValueError('無效框座標')
            left,top,right,bottom=coords
            if not (0<=left<right<=1 and 0<=top<bottom<=1):raise ValueError('框必須在照片內且有面積')
            clean.append({'label':label,'box':coords})
        if old:write_json(self.root/'history'/f'{id}-{uuid.uuid4().hex}.json',old)
        (self.root/'images'/f'{id}.png').write_bytes(raw)
        record={'id':id,'filename':str(b.get('filename','photo'))[:200],'width':im.width,'height':im.height,'boxes':clean,'split':split,'group':group,'reviewed':True,'negative':not clean,'note':str(b.get('note',''))[:2000],'updated':now(),'revision':old['revision']+1 if old else 1}
        write_json(self.root/'records'/f'{id}.json',record);return record
    def export(self,require_training=False,practice_id=None):
        records=self.records();classes=self.classes()
        if not records or not classes:raise ValueError('請先新增品項並保存人工核對標註')
        if practice_id is not None:
            if not require_training:raise ValueError('單張練習僅供訓練使用')
            record=self.record(practice_id)
            if record['split']!='train' or not record['boxes']:raise ValueError('請選一張已保存、有框的訓練集照片')
            records=[record]
        if require_training and practice_id is None:
            for split in ['train','val']:
                if not any(r['split']==split and r['boxes'] for r in records):raise ValueError('訓練集、驗證集各需至少一張有框圖片')
            train_labels={x['label'] for r in records if r['split']=='train' for x in r['boxes']}
            absent={x['label'] for r in records if r['split']!='train' for x in r['boxes']}-train_labels
            if absent:raise ValueError('這些驗證／測試類別尚無訓練樣本：'+','.join(sorted(absent)))
        id=uuid.uuid4().hex;target=self.root/'exports'/id;target.mkdir()
        for split in ['train','val','test']:
            (target/'images'/split).mkdir(parents=True);(target/'labels'/split).mkdir(parents=True)
        for r in records:
            split=r['split'];shutil.copy2(self.root/'images'/f"{r['id']}.png",target/'images'/split/f"{r['id']}.png")
            lines=[]
            for x in r['boxes']:
                l,t,rr,bb=x['box'];lines.append(f"{classes.index(x['label'])} {(l+rr)/2:.8f} {(t+bb)/2:.8f} {rr-l:.8f} {bb-t:.8f}")
            (target/'labels'/split/f"{r['id']}.txt").write_text('\n'.join(lines),encoding='utf-8')
        # 可攜式相對路徑；worker 訓練時生成包含絕對路徑的本機設定。
        config={'path':'.','train':'images/train','val':'images/train' if practice_id else 'images/val','names':dict(enumerate(classes))}
        if any(r['split']=='test' for r in records):config['test']='images/test'
        write_json(target/'data.yaml',config) # JSON 是合法 YAML，保留中文及跳脫字元。
        write_json(target/'manifest.json',{'created':now(),'classes':classes,'records':records,'practiceOnly':practice_id is not None,'validationIndependent':practice_id is None})
        with zipfile.ZipFile(target.with_suffix('.zip'),'w',zipfile.ZIP_DEFLATED) as z:
            for p in target.rglob('*'):
                if p.is_file():z.write(p,p.relative_to(target))
        return id,target
