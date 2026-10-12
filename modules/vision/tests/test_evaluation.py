"""評估計算：配對、各品項精確率／召回率、門檻掃描、校準、發布比較。"""
import unittest
import helpers  # noqa: F401
from vision_core.evaluation import calibrate, compare, evaluate, iou, match, summarize, test_set_fingerprint

A = [.1, .1, .3, .3]; B = [.5, .5, .7, .7]; C = [.1, .5, .3, .7]


def box(label, b, conf=None):
    return {'label': label, 'box': b} if conf is None else {'label': label, 'box': b, 'confidence': conf}


class EvaluationTests(unittest.TestCase):
    def test_iou(self):
        self.assertAlmostEqual(iou(A, A), 1.0); self.assertEqual(iou(A, B), 0.0)
        self.assertAlmostEqual(iou([0, 0, .2, .2], [.1, 0, .3, .2]), 1 / 3)

    def test_match_one_prediction_per_truth(self):
        pairs, missed = match([box('水', A)], [box('水', A, .9), box('水', A, .8), box('水', B, .7)], .5)
        self.assertEqual([ok for _, ok in pairs], [True, False, False]); self.assertEqual(missed['水'], 0)
        pairs, missed = match([box('水', A), box('米', B)], [box('水', B, .9)], .5)
        self.assertEqual([ok for _, ok in pairs], [False]); self.assertEqual(missed, {'水': 1, '米': 1})

    def test_summary_keeps_count_metrics_and_adds_per_class(self):
        samples = [{'id': '1', 'truth': [box('水', A), box('水', B)], 'predictions': [box('水', A, .9), box('水', B, .2)]},
                   {'id': '2', 'truth': [box('米', A)], 'predictions': [box('米', A, .8), box('水', C, .6)]}]
        high = summarize(samples, .5, .5)
        self.assertEqual(high['exactItemAndCountRate'], 0.0); self.assertEqual(high['meanAbsoluteCountErrorPerImage'], 1.0)
        self.assertEqual(high['perClass']['水'], {'truth': 2, 'predicted': 2, 'tp': 1, 'fp': 1, 'fn': 1, 'precision': .5, 'recall': .5})
        self.assertEqual(high['perClass']['米']['recall'], 1.0)
        low = summarize(samples, .1, .5); self.assertEqual(low['perClass']['水']['recall'], 1.0)
        self.assertEqual(low['rows'][0]['exact'], True)

    def test_calibration_finds_lowest_threshold_meeting_target(self):
        truth = [box('水', [i / 10, 0, i / 10 + .05, .1]) for i in range(6)]
        preds = [box('水', b['box'], c) for b, c in zip(truth, [.95, .9, .85, .8, .7, .6])] + [box('水', [0, .5, .1, .6], .75)]
        result = calibrate([{'id': '1', 'truth': truth, 'predictions': preds}], .5, .9, 5, .05)
        water = result['classes']['水']
        self.assertEqual(water['threshold'], .8); self.assertEqual(water['precision'], 1.0); self.assertAlmostEqual(water['recall'], 4 / 6)
        self.assertEqual(result['skipped'], {})

    def test_calibration_skips_small_classes_and_flags_unreachable(self):
        samples = [{'id': '1', 'truth': [box('米', A)], 'predictions': [box('米', A, .9)]},
                   {'id': '2', 'truth': [box('水', [i / 10, 0, i / 10 + .05, .1]) for i in range(5)], 'predictions': [box('水', [0, .5, .1, .6], .9)]}]
        result = calibrate(samples, .5, .9, 5, .05)
        self.assertIn('米', result['skipped']); self.assertFalse(result['classes']['水']['reachable']); self.assertEqual(result['classes']['水']['threshold'], .99)

    def test_evaluate_report_and_compare(self):
        samples = [{'id': '1', 'truth': [box('水', A)], 'predictions': [box('水', A, .9)]}]
        report = evaluate(samples, .15, .5, .9, 5, .05)
        self.assertEqual(report['exactItemAndCountRate'], 1.0); self.assertEqual(len(report['sweep']), 19)
        with self.assertRaises(ValueError):evaluate([], .15, .5, .9, 5, .05)
        base = {'testSetFingerprint': 'x', 'exactItemAndCountRate': .5, 'meanAbsoluteCountErrorPerImage': 1.0}
        self.assertTrue(compare({**base, 'exactItemAndCountRate': .6}, base, 0, 0)[0])
        self.assertFalse(compare({**base, 'exactItemAndCountRate': .4}, base, 0, 0)[0])
        self.assertTrue(compare({**base, 'exactItemAndCountRate': .45}, base, .1, 0)[0])
        self.assertFalse(compare({**base, 'meanAbsoluteCountErrorPerImage': 1.5}, base, 0, 0)[0])
        self.assertFalse(compare({**base, 'testSetFingerprint': 'y'}, base, 1, 1)[0])

    def test_fingerprint_tracks_test_set_only(self):
        records = [{'id': 'a', 'split': 'test', 'revision': 1}, {'id': 'b', 'split': 'train', 'revision': 1}]
        same = test_set_fingerprint(records)
        self.assertEqual(same, test_set_fingerprint(records[:1] + [{'id': 'b', 'split': 'train', 'revision': 2}]))
        self.assertNotEqual(same, test_set_fingerprint([{'id': 'a', 'split': 'test', 'revision': 2}]))


if __name__ == '__main__':unittest.main()
