"""本機獨立模式的 HTTP 契約：介面、本機防護、資料、模型管理、資料鎖。"""
import subprocess, sys, unittest
from unittest.mock import patch
from helpers import ROOT, data_url, fake_evaluation, fake_trained_model, make_core
from bootstrap import standalone_app
from vision_core.dataset import Dataset


class ModuleTests(unittest.TestCase):
    def setUp(self):
        self.core = make_core(self, release={'regression_gate': False})
        self.client = standalone_app(self.core).test_client(); self.headers = {'Origin': 'http://127.0.0.1:5182'}
        self.image = data_url()

    def post(self, path, body):return self.client.post('/api/v1' + path, json=body, headers=self.headers)

    def sample(self):
        self.core.dataset.add_class('瓶裝水')
        return self.core.dataset.save({'image': self.image, 'reviewed': True, 'split': 'train', 'boxes': [{'label': '瓶裝水', 'box': [.1, .1, .8, .8]}]})

    def test_independent_ui_and_contract(self):
        self.assertEqual(self.client.get('/workbench').status_code, 200)
        self.assertIn('準備正確答案', self.client.get('/workbench').get_data(as_text=True))
        self.assertIn('window.VISION_PRODUCTION=false', self.client.get('/editor').get_data(as_text=True))
        spec = self.client.get('/api/v1/openapi.json').json; self.assertEqual(spec['openapi'], '3.1.0')
        self.assertEqual(self.client.get('/api/v1/health').json['service'], 'vision-module')
        self.assertEqual(self.client.get('/health').headers['X-Vision-API-Version'], '1.0')

    def test_local_write_origin_and_host(self):
        self.assertEqual(self.client.post('/api/v1/classes', json={'name': '水'}).status_code, 403)
        self.assertEqual(self.client.get('/api/v1/status', headers={'Host': 'attacker.invalid'}).status_code, 403)
        self.assertEqual(self.post('/classes', {'name': '水'}).status_code, 200)
        # 舊版未加 /api/v1 的路徑仍可用
        self.assertEqual(self.client.post('/classes', json={'name': '茶'}, headers=self.headers).status_code, 200)

    def test_readiness_and_persistence(self):
        self.assertFalse(self.client.get('/api/v1/module').json['readiness']['canPractice'])
        self.sample(); r = self.client.get('/api/v1/module').json['readiness']
        self.assertTrue(r['canPractice']); self.assertFalse(r['canTrain']); self.assertFalse(r['canEvaluate'])
        self.assertEqual(len(Dataset(self.core.data).records()), 1)

    def test_mapping_and_prediction_contract(self):
        self.sample(); self.assertEqual(self.post('/catalog', {'mappings': [{'label': '瓶裝水', 'itemId': 'item-42'}]}).status_code, 200)
        with patch.object(self.core.detector, 'infer', return_value=[{'label': '瓶裝水', 'box': [.1, .1, .8, .8], 'confidence': .8}]) as infer:
            r = self.post('/predict', {'image': self.image})
            self.assertEqual(r.status_code, 200, r.json); self.assertEqual(r.json['objects'][0]['itemId'], 'item-42')
            self.assertEqual(r.json['counts'], {'瓶裝水': 1}); self.assertEqual(r.json['apiVersion'], '1.0')
            self.assertEqual(infer.call_args.args[2], .25)  # 預設門檻來自設定檔
        self.assertEqual(self.post('/catalog', {'mappings': [{'label': '不存在', 'itemId': 'x'}]}).status_code, 400)

    def test_practice_model_not_activatable_and_rename(self):
        fake_trained_model(self.core, 'model1', practice=True, config={'displayName': '第一版'})
        models = self.client.get('/api/v1/module').json['models']; self.assertFalse(models[1]['canActivate'])
        self.assertEqual(self.post('/activate', {'model': 'model1'}).status_code, 400)
        self.assertEqual(self.post('/models/rename', {'model': 'model1', 'name': '飲品練習'}).status_code, 200)
        self.assertEqual(self.client.get('/api/v1/module').json['models'][1]['name'], '飲品練習')

    def test_active_model_default_and_shared_data_lock(self):
        fake_trained_model(self.core, 'normal')
        fake_evaluation(self.core, 'normal', 'eval')
        self.assertEqual(self.post('/activate', {'model': 'normal'}).status_code, 200)
        with patch.object(self.core.detector, 'infer', return_value=[]) as predict:
            self.assertEqual(self.post('/predict', {'image': self.image}).json['model'], 'normal')
            self.assertEqual(predict.call_args.args[1], 'normal')
        # 其他程序不可取得同一資料目錄
        from vision_core import locking
        locking.acquire(self.core.data)
        code = 'from pathlib import Path; from vision_core.locking import acquire; acquire(Path(' + repr(str(self.core.data)) + '))'
        r = subprocess.run([sys.executable, '-c', code], cwd=ROOT, capture_output=True)
        self.assertNotEqual(r.returncode, 0)
        locking._handle.close()

    def test_standalone_has_no_host_recognition(self):
        self.assertEqual(self.post('/recognize', {'locationId': 1}).status_code, 404)

    def test_errors_are_json(self):
        r = self.client.get('/api/v1/sample/not-an-id'); self.assertEqual(r.status_code, 400); self.assertIn('無效圖片ID', r.json['error'])
        self.assertEqual(self.client.get('/api/v1/nothing-here').status_code, 404)


if __name__ == '__main__':unittest.main()
