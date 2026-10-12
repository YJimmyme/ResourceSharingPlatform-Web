"""OpenAI 複核（ReviewProvider）：看整張照片重新辨識，結果取代 YOLO 框而非相加。"""
import base64, io, json
import requests
from vision_core.errors import VisionError

REASONING_MODELS = ('gpt-5', 'o1', 'o3', 'o4')
PROMPT = ('依整張照片的外觀，辨識所有可見獨立物件與外包裝。一箱算一箱，不推算箱內數量。不讀品牌、容量或效期。不把圖案當實物。每個實物只輸出一次，不得重複框。'
          '框必須包含完整可見物件。無法確認請填 needs_review=true 並說明 uncertainty；不得猜測不可見物品。'
          '只回傳JSON {"objects":[{"label":"品項","box":[左,上,右,下],"confidence":0.8}],"needs_review":false,"uncertainty":""}，座標為0到1。目錄只是名稱參考，外包裝不符時不得強套。')


class OpenAIReviewer:
    def __init__(self, api_key, model='gpt-4.1-mini', complex_model='gpt-4.1', endpoint='https://api.openai.com/v1/chat/completions', max_side=2048):
        self.api_key = api_key; self.model = model; self.complex_model = complex_model; self.endpoint = endpoint; self.max_side = max_side

    @classmethod
    def from_env(cls, env):
        return cls(env.get('OPENAI_API_KEY', ''), env.get('OPENAI_MODEL', 'gpt-4.1-mini'), env.get('OPENAI_COMPLEX_MODEL', 'gpt-4.1'))

    def _image(self, image):
        cloud = image.copy(); cloud.thumbnail((self.max_side, self.max_side)); out = io.BytesIO(); cloud.save(out, format='JPEG', quality=90)
        return 'data:image/jpeg;base64,' + base64.b64encode(out.getvalue()).decode()

    def review(self, image, boxes, catalog, complexity):
        if not self.api_key:raise VisionError('未設定 OpenAI API Key，請人工核對')
        model = self.complex_model if complexity == 'complex' else self.model
        prompt = (PROMPT + '\n目錄：' + json.dumps([{'name': d['item_name'], 'unit': d.get('unit')} for d in catalog], ensure_ascii=False)
                  + '\nYOLO初步框（可能漏判或誤判，需重新看整圖）：' + json.dumps(boxes, ensure_ascii=False))
        payload = {'model': model, 'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': prompt}, {'type': 'image_url', 'image_url': {'url': self._image(image), 'detail': 'high'}}]}]}
        payload['max_completion_tokens' if model.startswith(REASONING_MODELS) else 'max_tokens'] = 3000
        if not model.startswith(REASONING_MODELS):payload['temperature'] = .1
        r = requests.post(self.endpoint, headers={'Authorization': 'Bearer ' + self.api_key}, json=payload, timeout=120)
        if not r.ok:
            try:code = r.json().get('error', {}).get('code', 'unknown')
            except Exception:code = 'unknown'
            raise VisionError(f'OpenAI HTTP {r.status_code} ({code})，已保留YOLO結果供人工確認')
        api = r.json(); raw = api['choices'][0]['message']['content']; clean = raw.strip()
        if clean.startswith('```'):clean = clean.split('\n', 1)[-1].rsplit('```', 1)[0]
        parsed = json.loads(clean)
        if not isinstance(parsed.get('objects'), list) or len(parsed['objects']) > 300:raise ValueError('OpenAI物件清單格式錯誤')
        return parsed, {'provider': 'openai', 'model': api.get('model', model), 'raw': raw, 'usage': api.get('usage')}
