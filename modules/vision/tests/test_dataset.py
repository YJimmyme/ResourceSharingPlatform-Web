import base64,io,tempfile,unittest,json,zipfile
from pathlib import Path
from PIL import Image
import helpers  # noqa: F401  (加入模組路徑)
from vision_core.dataset import Dataset
def photo(color):
    b=io.BytesIO();Image.new('RGB',(100,80),color).save(b,format='PNG');return 'data:image/png;base64,'+base64.b64encode(b.getvalue()).decode()
class DataTests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.ds=Dataset(self.tmp.name);self.ds.add_class('杯裝泡麵')
    def record(self,color='white',**kw):return {'image':photo(color),'reviewed':True,'split':'train','boxes':[{'label':'杯裝泡麵','box':[.1,.2,.5,.6]}],**kw}
    def test_label_mapping_and_export(self):
        self.ds.save(self.record());self.ds.save(self.record('black',split='val'));self.ds.add_class('瓶裝水');id,path=self.ds.export(True)
        labels=list((path/'labels/train').glob('*.txt'))[0].read_text();self.assertEqual(labels,'0 0.30000000 0.40000000 0.40000000 0.40000000')
        with zipfile.ZipFile(path.with_suffix('.zip')) as z:self.assertIn('data.yaml',z.namelist())
        self.assertEqual(self.ds.classes(),['杯裝泡麵','瓶裝水'])
    def test_no_split_or_group_leak(self):
        self.ds.save(self.record(group='連拍1'))
        with self.assertRaises(ValueError):self.ds.save(self.record(split='val',group='連拍1'))
        with self.assertRaises(ValueError):self.ds.save(self.record('black',split='test',group='連拍1'))
    def test_review_empty_and_unknown(self):
        with self.assertRaises(ValueError):self.ds.save(self.record(reviewed=False))
        with self.assertRaises(ValueError):self.ds.save(self.record(boxes=[]))
        with self.assertRaises(ValueError):self.ds.save(self.record(boxes=[{'label':'unknown','box':[0,0,1,1]}]))
        self.ds.save(self.record(boxes=[],negative=True))
    def test_single_photo_practice_is_explicit_and_isolated(self):
        r=self.ds.save(self.record())
        with self.assertRaises(ValueError):self.ds.export(True)
        id,path=self.ds.export(True,practice_id=r['id'])
        manifest=json.loads((path/'manifest.json').read_text(encoding='utf-8'))
        self.assertTrue(manifest['practiceOnly']);self.assertFalse(manifest['validationIndependent'])
        self.assertEqual(len(manifest['records']),1)
        self.assertEqual(json.loads((path/'data.yaml').read_text(encoding='utf-8'))['val'],'images/train')
        self.assertEqual(self.ds.record(r['id'])['split'],'train')
        self.assertEqual(list((path/'images/val').glob('*')),[])
        other=self.ds.save(self.record('black',split='val'))
        with self.assertRaises(ValueError):self.ds.export(True,practice_id=other['id'])
    def test_revision_snapshot(self):
        first=self.ds.save(self.record());id,path=self.ds.export();self.ds.save(self.record(note='修正',boxes=[{'label':'杯裝泡麵','box':[.2,.2,.8,.8]}]))
        self.assertEqual(self.ds.record(first['id'])['revision'],2)
        self.assertEqual(len(list((self.ds.root/'history').glob('*.json'))),1)
        self.assertEqual(json.loads((path/'manifest.json').read_text(encoding='utf-8'))['records'][0]['revision'],1)
if __name__=='__main__':unittest.main()
