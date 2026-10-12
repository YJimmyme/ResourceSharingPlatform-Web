"""獨立 .qa-yolo 資料測試：不寫入使用者 yolo-data。"""
import os,io,base64,json,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
os.environ['YOLO_LAB_DATA']=str(ROOT/'.qa-yolo')
import yolo_worker
from yolo_worker import app,ds
from PIL import Image,ImageDraw
client=app.test_client();headers={'Origin':'http://127.0.0.1:5180'}
def post(path,data):
    r=client.post(path,json=data,headers=headers)
    if r.status_code!=200:raise RuntimeError(r.get_json())
    return r.get_json()
post('/classes',{'name':'測試方塊'})
for i,split in enumerate(['train','val','test']):
    im=Image.new('RGB',(320,240),(240-i*10,240,240));ImageDraw.Draw(im).rectangle((80,60,200,180),fill=(20,100+i*20,180))
    buf=io.BytesIO();im.save(buf,format='PNG');image='data:image/png;base64,'+base64.b64encode(buf.getvalue()).decode()
    post('/save',{'image':image,'filename':'流程測試-'+split+'.png','split':split,'reviewed':True,'boxes':[{'label':'測試方塊','box':[.25,.25,.625,.75]}]})
    if split=='test':test_image=image
result=post('/predict',{'image':test_image,'model':'pretrained'});print('PREDICT_OK',len(result['boxes']),flush=True)
export=post('/export',{});assert client.get('/download/'+export['id']).status_code==200
job=post('/train',{'model':'pretrained','epochs':1,'device':'cpu'})
while True:
    state=client.get('/status').get_json()['job']
    if state['status'] not in ['starting','running','finishing']:break
    time.sleep(2)
print('TRAIN',json.dumps({k:v for k,v in state.items() if k!='log'},ensure_ascii=True),flush=True)
if state['status']!='completed':print(state['log']);raise RuntimeError('training smoke failed')
yolo_worker.active['process'].wait(timeout=30)
trained=post('/predict',{'image':test_image,'model':job['id']});print('CUSTOM_PREDICT_OK',flush=True)
post('/train',{'mode':'evaluate','model':job['id'],'device':'cpu'})
while True:
    state=client.get('/status').get_json()['job']
    if state['status'] not in ['starting','running','finishing']:break
    time.sleep(2)
assert state['status']=='completed',state
print('EVALUATE_OK',json.dumps(state['evaluation']),flush=True)
