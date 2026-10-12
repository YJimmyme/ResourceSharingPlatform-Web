"""發布門檻、校準門檻帶入上線設定、改善建議。"""
import unittest
from helpers import data_url, fake_evaluation, fake_trained_model, make_core
from vision_core import improvement
from vision_core.errors import VisionError
from vision_core.storage import write_json


def report(rate, error, fingerprint='fp1', calibration=None):
    return {'testSetFingerprint': fingerprint, 'exactItemAndCountRate': rate, 'meanAbsoluteCountErrorPerImage': error, 'images': 10,
            'precision': .9, 'recall': .8, 'perClass': {'瓶裝水': {'precision': .9, 'recall': .5}},
            'calibration': calibration or {'classes': {'瓶裝水': {'threshold': .42, 'reachable': True}}, 'global': {'threshold': .5, 'reachable': True}}}


class ReleaseGateTests(unittest.TestCase):
    def setUp(self):
        self.core = make_core(self); self.registry = self.core.registry
        fake_trained_model(self.core, 'v1'); fake_trained_model(self.core, 'v2')

    def test_first_release_requires_baseline_on_same_test_set(self):
        fake_evaluation(self.core, 'v1', 'e1', report(.6, .5))
        with self.assertRaisesRegex(VisionError, '同一份保留測試集評估目前上線模型'):self.registry.activate('v1')
        fake_evaluation(self.core, 'pretrained', 'e0', report(0.0, 3.0))
        record = self.registry.activate('v1', 'admin-1')
        self.assertEqual(record['model'], 'v1'); self.assertEqual(record['reviewThresholds'], {'瓶裝水': .42}); self.assertIn('完全正確率', record['note'])
        self.assertEqual(self.registry.review_thresholds(), {'瓶裝水': .42})

    def test_regression_blocked_and_rollback_allowed(self):
        fake_evaluation(self.core, 'pretrained', 'e0', report(0.0, 3.0)); fake_evaluation(self.core, 'v1', 'e1', report(.6, .5))
        self.registry.activate('v1')
        fake_evaluation(self.core, 'v2', 'e2', report(.5, .5))
        with self.assertRaisesRegex(VisionError, '新模型表現較差'):self.registry.activate('v2')
        fake_evaluation(self.core, 'v2', 'e3', report(.7, .4), finished='2026-10-10T00:00:00')
        self.registry.activate('v2'); self.assertEqual(self.registry.active(), 'v2')
        self.assertEqual(self.registry.activate('v1')['note'], '回復先前發布過的模型，略過退步檢查')

    def test_different_test_sets_cannot_be_compared(self):
        fake_evaluation(self.core, 'pretrained', 'e0', report(0.0, 3.0, 'old'))
        fake_evaluation(self.core, 'v1', 'e1', report(.6, .5, 'new'))
        with self.assertRaises(VisionError):self.registry.activate('v1')

    def test_legacy_evaluation_must_be_rerun_when_gated(self):
        fake_evaluation(self.core, 'v1', 'e1')
        with self.assertRaisesRegex(VisionError, '重新執行保留集評估'):self.registry.activate('v1')

    def test_calibration_can_be_disabled(self):
        core = make_core(self, review={'use_calibrated_thresholds': False}, release={'regression_gate': False})
        fake_trained_model(core, 'v1'); fake_evaluation(core, 'v1', 'e1', report(.6, .5))
        self.assertNotIn('reviewThresholds', core.registry.activate('v1'))

    def test_model_list_shows_latest_evaluation(self):
        fake_evaluation(self.core, 'v1', 'e1', report(.6, .5))
        v1 = next(m for m in self.registry.describe() if m['id'] == 'v1')
        self.assertTrue(v1['canActivate']); self.assertEqual(v1['evaluation']['exactItemAndCountRate'], .6)


class ImprovementTests(unittest.TestCase):
    def test_suggestions_point_at_missing_and_weak_classes(self):
        core = make_core(self); core.dataset.add_class('瓶裝水'); core.dataset.add_class('米酒')
        core.dataset.save({'image': data_url('red'), 'reviewed': True, 'split': 'train', 'boxes': [{'label': '瓶裝水', 'box': [.1, .1, .5, .5]}]})
        fake_trained_model(core, 'v1'); fake_evaluation(core, 'v1', 'e1', report(.6, .5))
        write_json(core.data / 'deployment.json', {'model': 'v1'})
        write_json(core.data / 'feedback' / ('a' * 32 + '.json'), {'id': 'a' * 32, 'provider': 'openai', 'reasons': ['YOLO未找到物件'], 'reviewed': True, 'approved': False,
                                                                  'audit': {'yolo_boxes': []}, 'corrected_boxes': [{'label': '米酒', 'box': [.1, .1, .4, .4]}]})
        s = improvement.summary(core)
        self.assertEqual(s['feedback']['awaitingApproval'], 1); self.assertEqual(s['activeModel']['id'], 'v1')
        rows = {r['label']: r for r in s['classes']}
        self.assertEqual(rows['瓶裝水']['trainBoxes'], 1); self.assertEqual(rows['米酒']['missedByYolo'], 1)
        texts = ' '.join(x['text'] for x in s['suggestions'])
        self.assertIn('「瓶裝水」訓練框 1 個', texts); self.assertIn('召回率 50%', texts); self.assertIn('YOLO 漏掉「米酒」1 個', texts); self.assertIn('空場景', texts)
        self.assertFalse(s['outcomes']['configured'])


if __name__ == '__main__':unittest.main()
