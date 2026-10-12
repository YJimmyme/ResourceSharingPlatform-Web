"""主系統（Supabase）整合模式：授權、YOLO／雲端分流、回饋審核、訓練與發布。外部服務全部為假回應。"""
import sys, types, unittest
from unittest.mock import Mock, patch
from helpers import data_url, fake_trained_model, make_core, png
from bootstrap import host_app
from vision_core.policy import canonical_boxes, fallback_reasons, grouped_items
from vision_core.storage import read_json, write_json

ENV = {'SUPABASE_URL': 'https://test.invalid', 'SUPABASE_ANON_KEY': 'test-anon', 'SUPABASE_SERVICE_ROLE_KEY': 'test-service', 'APP_ORIGIN': 'http://localhost', 'OPENAI_API_KEY': 'test-key'}


class Response:
    def __init__(self, data=None, status=200, content=b'x'):self.data = data; self.status_code = status; self.ok = status < 400; self.content = content
    def json(self):return self.data


class HostTests(unittest.TestCase):
    gate = False

    def setUp(self):
        self.core = make_core(self, release={'regression_gate': self.gate})
        self.role = 'Admin'; self.active = True; self.catalog = [{'item_name': '瓶裝水', 'category': '飲品', 'unit': '瓶', 'stock_type': 'NoExpiry'}]
        self.conf = .9; self.label = '瓶裝水'; self.openai_calls = 0; self.api_status = 200; self.raw = png(size=(100, 80)); self.inserted = []
        self.client = host_app(self.core, env=ENV).test_client(); self.headers = {'Origin': 'http://localhost', 'Authorization': 'Bearer test-session'}
        for name, fn in [('get', self.get), ('request', self.rest), ('post', self.openai)]:
            p = patch('requests.' + name, side_effect=fn); p.start(); self.addCleanup(p.stop)
        p = patch.dict(sys.modules, {'ultralytics': types.SimpleNamespace(YOLO=lambda _: self)}); p.start(); self.addCleanup(p.stop)

    # ---- 假的 YOLO、Supabase、OpenAI ----
    def predict(self, *args, **kwargs):
        arr = lambda value: types.SimpleNamespace(tolist=lambda: value)
        return [types.SimpleNamespace(names={0: self.label}, boxes=types.SimpleNamespace(xyxyn=arr([[.1, .1, .5, .5]]), cls=arr([0]), conf=arr([self.conf])))]

    def get(self, url, **kwargs):
        if '/auth/' in url:return Response({'id': 'user-1'})
        if '/storage/' in url:return Response(content=self.raw)
        raise AssertionError(url)

    def rest(self, method, url, **kwargs):
        if '/profiles?' in url:return Response([{'id': 'user-1', 'role_name': self.role, 'location_id': 1, 'is_active': self.active, 'display_name': 'Tester', 'username': 'tester'}])
        if '/inventory_item_definition?' in url:return Response(self.catalog)
        if '/catalog_synonym?' in url:return Response([])
        if '/ai_stock_in_log' in url:self.inserted.extend(kwargs['json']); return Response([dict(x, id=i + 1) for i, x in enumerate(kwargs['json'])])
        raise AssertionError(url)

    def openai(self, *args, **kwargs):
        self.openai_calls += 1
        if self.api_status != 200:return Response({'error': {'code': 'insufficient_quota'}}, self.api_status)
        return Response({'choices': [{'message': {'content': '{"objects":[{"label":"瓶裝水","box":[0.1,0.1,0.5,0.5],"confidence":0.9}],"needs_review":false}'}}]})

    def post(self, path, body):return self.client.post(path, json=body, headers=self.headers)
    def recognize(self, **kw):return self.post('/recognize', {'locationId': 1, 'imagePath': 'user-1/photo.png', **kw})


class AuthorizationTests(HostTests):
    def test_auth_and_scope(self):
        self.assertEqual(self.client.get('/status').status_code, 401)
        self.role = 'Cadre'; self.assertEqual(self.client.get('/status', headers=self.headers).status_code, 403)
        self.assertEqual(self.recognize(locationId=2).status_code, 403)
        self.assertEqual(self.recognize(imagePath='other/photo.png').status_code, 403)
        self.active = False; self.assertEqual(self.recognize().status_code, 403)
        self.active = True; self.role = 'SocialWorker'; self.assertEqual(self.recognize().status_code, 403)

    def test_origin(self):
        self.headers['Origin'] = 'http://wrong'; self.assertEqual(self.recognize().status_code, 403)

    def test_versioned_api_keeps_authorization(self):
        self.assertEqual(self.client.get('/api/v1/status').status_code, 401)
        self.assertEqual(self.client.get('/editor').status_code, 200)
        self.assertIn('window.VISION_PRODUCTION=true', self.client.get('/workbench').get_data(as_text=True))
        self.role = 'Cadre'
        self.assertEqual(self.client.get('/api/v1/module', headers=self.headers).status_code, 403)
        result = self.post('/api/v1/recognize', {'locationId': 1, 'imagePath': 'user-1/photo.png'})
        self.assertEqual(result.status_code, 200, result.json)
        self.assertEqual(self.post('/api/v1/activate', {'model': 'pretrained'}).status_code, 403)
        self.assertEqual(self.client.get('/api/v1/improvement', headers=self.headers).status_code, 403)
        self.role = 'Admin'
        self.assertEqual(self.client.get('/api/v1/module', headers=self.headers).status_code, 200)

    def test_unexpected_errors_are_hidden(self):
        with patch.object(self.core, 'status', side_effect=RuntimeError('secret path')):
            r = self.client.get('/status', headers=self.headers)
        self.assertEqual(r.status_code, 500); self.assertNotIn('secret', r.json['error'])


class RecognitionTests(HostTests):
    def test_yolo_high_confidence_skips_cloud(self):
        r = self.recognize(); self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(r.json['feedback']['provider'], 'yolo'); self.assertEqual(self.openai_calls, 0)
        self.assertEqual(r.json['logs'][0]['suggested_quantity'], 1)
        row = self.inserted[0]; self.assertEqual(row['operator'], 'Tester'); self.assertEqual(row['suggested_unit'], '瓶')
        self.assertIn(r.json['feedback']['id'], row['suggested_remark'])

    def test_cloud_replaces_instead_of_adds(self):
        self.conf = .3; r = self.recognize(); self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(self.openai_calls, 1); self.assertEqual(r.json['feedback']['provider'], 'openai')
        self.assertEqual(r.json['logs'][0]['suggested_quantity'], 1)

    def test_quota_retains_boxes_requires_manual_count(self):
        self.api_status = 429; r = self.recognize(forceReview=True)
        self.assertEqual(r.status_code, 200, r.json); self.assertEqual(len(r.json['feedback']['boxes']), 1)
        self.assertIsNone(r.json['logs'][0]['suggested_quantity']); self.assertIn('429', r.json['feedback']['warnings'][0])

    def test_unknown_requests_cloud(self):
        self.label = 'unknown'; self.recognize(); self.assertEqual(self.openai_calls, 1)

    def test_catalog_synced_into_classes(self):
        self.catalog = [dict(self.catalog[0], id=7)]; self.recognize()
        self.assertIn('瓶裝水', self.core.dataset.classes())
        self.assertEqual(read_json(self.core.data / 'catalog-mapping.json'), {'瓶裝水': '7'})

    def test_calibrated_class_threshold_triggers_review(self):
        write_json(self.core.data / 'deployment.json', {'model': 'pretrained', 'reviewThresholds': {'瓶裝水': .95}})
        r = self.recognize(); self.assertEqual(self.openai_calls, 1)
        self.assertIn('部分物件信心低於設定門檻', r.json['feedback']['reasons'])


class FeedbackTests(HostTests):
    def test_feedback_review_approval_and_export(self):
        r = self.recognize().json['feedback']; id = r['id']
        self.assertEqual(self.post('/approve-feedback', {'id': id}).status_code, 400)
        self.assertEqual(self.post('/feedback', {'id': id, 'boxes': r['boxes']}).status_code, 400)
        self.assertEqual(self.post('/feedback', {'id': id, 'boxes': r['boxes'], 'reviewed': True}).status_code, 200)
        self.assertEqual(len(self.core.dataset.records()), 0)
        self.assertEqual(self.post('/approve-feedback', {'id': id, 'split': 'train'}).status_code, 200)
        self.assertEqual(len(self.core.dataset.records()), 1); self.assertEqual(self.post('/export', {}).status_code, 200)
        self.assertEqual(self.post('/approve-feedback', {'id': id}).status_code, 400)
        detail = self.client.get('/feedback-detail/' + id, headers=self.headers).json
        self.assertTrue(detail['record']['approved']); self.assertTrue(detail['image'].startswith('data:image/png'))

    def test_negative_and_foreign_feedback(self):
        r = self.recognize().json['feedback']; id = r['id']
        self.assertEqual(self.post('/feedback', {'id': id, 'boxes': [], 'reviewed': True}).status_code, 400)
        self.assertEqual(self.post('/feedback', {'id': id, 'boxes': [], 'reviewed': True, 'negative': True}).status_code, 200)
        p = self.core.data / 'feedback' / (id + '.json'); data = read_json(p); data['owner'] = 'other'; write_json(p, data); self.role = 'Cadre'
        self.assertEqual(self.post('/feedback', {'id': id, 'boxes': r['boxes'], 'reviewed': True}).status_code, 403)

    def test_feedback_list_prioritizes_model_mistakes(self):
        good = self.recognize().json['feedback']['id']
        self.conf = .3; bad = self.recognize().json['feedback']['id']
        rows = self.client.get('/feedback-list', headers=self.headers).json['rows']
        self.assertEqual([r['id'] for r in rows], [bad, good]); self.assertIn('YOLO 結果未被採用', rows[0]['priorityReasons'])


class ModelTests(HostTests):
    def test_activation_requires_completed_evaluation(self):
        run = fake_trained_model(self.core, 'abc')
        self.assertEqual(self.post('/activate', {'model': 'abc'}).status_code, 400)
        ev = self.core.data / 'runs/eval'; ev.mkdir(); write_json(ev / 'state.json', {'mode': 'evaluate', 'status': 'completed'})
        write_json(ev / 'config.json', {'model': str(run / 'train/weights/best.pt')})  # 舊版評估只記錄權重路徑
        self.assertEqual(self.post('/activate', {'model': 'abc'}).status_code, 200)
        self.assertEqual(self.post('/activate', {'model': 'pretrained'}).status_code, 200)

    def test_train_creates_snapshot_and_spawns_isolated_job(self):
        self.core.dataset.add_class('瓶裝水')
        for color, split in [('red', 'train'), ('blue', 'val'), ('green', 'test')]:
            self.core.dataset.save({'image': data_url(color, (100, 80)), 'reviewed': True, 'split': split, 'boxes': [{'label': '瓶裝水', 'box': [.1, .1, .8, .8]}]})
        with patch('vision_core.jobs.subprocess.Popen', return_value=Mock(poll=Mock(return_value=None))) as spawn:
            r = self.post('/train', {'mode': 'train', 'model': 'pretrained', 'epochs': 1, 'device': 'cpu'})
            self.assertEqual(r.status_code, 200, r.json); spawn.assert_called_once()
            self.assertEqual(spawn.call_args.args[0][1:3], ['-m', 'vision_core.training'])
            config = read_json(self.core.data / 'runs' / r.json['id'] / 'config.json')
            self.assertTrue((self.core.data / 'exports').exists()); self.assertEqual(config['confidence'], .15)
            self.assertEqual(config['train']['batch'], 2); self.assertEqual(config['evaluation']['iou_match'], .5)
            self.assertEqual(self.post('/train', {'mode': 'train', 'model': 'pretrained'}).status_code, 400)

    def test_practice_requires_explicit_sample_and_cannot_publish(self):
        self.assertEqual(self.post('/train', {'mode': 'train', 'practiceOnly': True}).status_code, 400)
        self.core.dataset.add_class('瓶裝水')
        record = self.core.dataset.save({'image': data_url(size=(100, 80)), 'reviewed': True, 'split': 'train', 'boxes': [{'label': '瓶裝水', 'box': [.1, .1, .8, .8]}]})
        with patch('vision_core.jobs.subprocess.Popen', return_value=Mock(poll=Mock(return_value=0))):
            r = self.post('/train', {'mode': 'train', 'model': 'pretrained', 'practiceOnly': True, 'practiceSample': record['id'], 'epochs': 1})
            self.assertEqual(r.status_code, 200, r.json)
            run = self.core.data / 'runs' / r.json['id']; self.assertTrue(read_json(run / 'config.json')['practiceOnly'])
            weights = run / 'train/weights/best.pt'; weights.parent.mkdir(parents=True); weights.touch()
            write_json(run / 'state.json', {'mode': 'train', 'status': 'completed'})
            response = self.post('/activate', {'model': r.json['id']})
            self.assertEqual(response.status_code, 400); self.assertIn('單張練習', response.json['error'])


class CrossOriginTests(HostTests):
    """網站在 GitHub Pages、辨識服務在另一個 HTTPS 網址。"""
    SITE = 'https://bill1114.github.io'; SERVICE = 'https://vision.example.org'

    def setUp(self):
        super().setUp()
        env = {**ENV, 'APP_ORIGIN': self.SITE, 'VISION_PUBLIC_ORIGIN': self.SERVICE}
        self.client = host_app(self.core, env=env).test_client(); self.headers = {'Origin': self.SITE, 'Authorization': 'Bearer test-session'}

    def preflight(self, origin):
        return self.client.options('/api/v1/recognize', headers={'Origin': origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type'})

    def test_preflight_only_for_host_site(self):
        ok = self.preflight(self.SITE)
        self.assertEqual(ok.status_code, 204); self.assertEqual(ok.headers['Access-Control-Allow-Origin'], self.SITE)
        self.assertIn('Authorization', ok.headers['Access-Control-Allow-Headers'])
        bad = self.preflight('https://evil.example'); self.assertEqual(bad.status_code, 403); self.assertNotIn('Access-Control-Allow-Origin', bad.headers)

    def test_site_can_recognize_and_read_errors(self):
        r = self.post('/api/v1/recognize', {'locationId': 1, 'imagePath': 'user-1/photo.png'})
        self.assertEqual(r.status_code, 200, r.json); self.assertEqual(r.headers['Access-Control-Allow-Origin'], self.SITE)
        denied = self.client.post('/api/v1/recognize', json={}, headers={'Origin': self.SITE})
        self.assertEqual(denied.status_code, 401); self.assertEqual(denied.headers['Access-Control-Allow-Origin'], self.SITE)

    def test_workbench_writes_from_service_origin_and_rejects_others(self):
        self.headers['Origin'] = self.SERVICE
        r = self.post('/api/v1/classes', {'name': '米酒'}); self.assertEqual(r.status_code, 200, r.json)
        self.assertNotIn('Access-Control-Allow-Origin', r.headers)  # 同源請求不需要 CORS
        self.headers['Origin'] = 'https://evil.example'; self.assertEqual(self.post('/api/v1/classes', {'name': '水'}).status_code, 403)

    def test_workbench_trusts_host_site_as_parent(self):
        page = self.client.get('/workbench').get_data(as_text=True)
        self.assertIn('window.VISION_PARENT_ORIGINS=["https://bill1114.github.io"]', page)

    def test_multiple_site_origins(self):
        client = host_app(self.core, env={**ENV, 'APP_ORIGIN': self.SITE + ', http://localhost:8080'}).test_client()
        self.assertEqual(client.options('/api/v1/feedback', headers={'Origin': 'http://localhost:8080'}).status_code, 204)


class PolicyTests(unittest.TestCase):
    def test_invalid_coordinates_and_grouped_counts(self):
        catalog = [{'item_name': '瓶裝水'}]
        with self.assertRaises(ValueError):canonical_boxes([{'label': 'x', 'box': [0, 0, 2, 1]}], [], [])
        boxes = canonical_boxes([{'label': 'bottle', 'box': [0, 0, 1, 1], 'confidence': .9}] * 2, catalog, [{'synonym': 'bottle', 'standard_name': '瓶裝水'}])
        self.assertEqual(grouped_items(boxes)[0]['quantity'], 2); self.assertFalse(fallback_reasons(boxes, catalog, .65))
        self.assertTrue(fallback_reasons(boxes, catalog, .65, class_thresholds={'瓶裝水': .95}))


if __name__ == '__main__':unittest.main()
