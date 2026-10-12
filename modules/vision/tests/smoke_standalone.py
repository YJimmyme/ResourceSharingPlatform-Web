"""Opt-in real CPU smoke test, isolated copied module; never uses user images.

驗證：模組可單獨複製執行 → 標註 → 單張練習 → 一般訓練 → 保留集評估（含各品項指標與校準）→ 發布門檻。
Run: python tests/smoke_standalone.py --weights /path/to/models
"""
import argparse,base64,io,json,os,shutil,subprocess,sys,tempfile,time
from pathlib import Path
import requests
from PIL import Image,ImageDraw

COPY=['vision_core','vision_http','vision_ui','adapters','config','contracts','bootstrap.py','run.py']

def picture(shift):
    image=Image.new('RGB',(192,192),(255-shift,255,255));ImageDraw.Draw(image).rectangle((45+shift,45,145+shift,145),fill='blue')
    stream=io.BytesIO();image.save(stream,format='PNG');return 'data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode(),[(45+shift)/192,45/192,(145+shift)/192,145/192]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--weights',required=True);parser.add_argument('--port',default='5192');args=parser.parse_args()
    source=Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='vision-smoke-') as temp:
        root=Path(temp)
        for name in COPY:
            (shutil.copytree if (source/name).is_dir() else shutil.copy)(source/name,root/name,**({'ignore':shutil.ignore_patterns('__pycache__')} if (source/name).is_dir() else {}))
        env=os.environ.copy();env.pop('VISION_PRODUCTION',None)
        env.update(VISION_DATA_DIR=str(root/'data'),VISION_MODEL_DIR=str(Path(args.weights).resolve()),VISION_PORT=args.port,PYTHONIOENCODING='utf-8')
        base=f'http://127.0.0.1:{args.port}/api/v1';headers={'Origin':f'http://127.0.0.1:{args.port}'}
        def call(route,body=None,expect=200):
            r=requests.get(base+route,timeout=60) if body is None else requests.post(base+route,json=body,headers=headers,timeout=120)
            assert r.status_code==expect,(route,r.status_code,r.text[:500]);return r.json()
        def wait():
            deadline=time.monotonic()+600
            while time.monotonic()<deadline:
                state=call('/status')['job']
                if state['status'] in ['completed','failed','stopped']:return state
                time.sleep(1)
            raise TimeoutError('job did not finish')
        with open(root/'server.log','w',encoding='utf-8') as log:
            process=subprocess.Popen([sys.executable,'run.py'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            try:
                for _ in range(100):
                    if process.poll() is not None:raise RuntimeError((root/'server.log').read_text(encoding='utf-8'))
                    try:
                        call('/health');break
                    except requests.ConnectionError:time.sleep(.2)
                assert Path(call('/status')['storage'])==(root/'data').resolve(), 'Port belongs to another service'
                call('/classes',{'name':'測試方塊'})
                records={}
                for i,split in enumerate(['train','train','val','test']):
                    image,box=picture(i*10)
                    records[split]=call('/save',{'image':image,'filename':f'synthetic-{i}.png','boxes':[{'label':'測試方塊','box':box}],'split':split,'group':f'g{i}','reviewed':True})['record']
                practice=call('/train',{'mode':'train','model':'pretrained','epochs':1,'device':'cpu','practiceOnly':True,'practiceSample':records['train']['id'],'displayName':'隔離流程測試'})['id']
                state=wait();assert state['status']=='completed',state
                prediction=call('/predict',{'image':picture(0)[0],'model':practice})
                assert prediction['model']==practice and prediction['apiVersion']=='1.0'
                call('/activate',{'model':practice},expect=400)
                normal=call('/train',{'mode':'train','model':'pretrained','epochs':2,'device':'cpu','displayName':'一般建模'})['id']
                state=wait();assert state['status']=='completed',state
                call('/train',{'mode':'evaluate','model':normal,'device':'cpu'});state=wait();assert state['status']=='completed',state
                evaluation=call('/evaluation/'+state['id'] if 'id' in state else '/status')
                for key in ['exactItemAndCountRate','perClass','sweep','calibration','testSetFingerprint']:assert key in evaluation,key
                gated=requests.post(base+'/activate',json={'model':normal},headers=headers,timeout=10)
                assert gated.status_code==400 and '同一份保留測試集' in gated.json()['error'],gated.text
                call('/train',{'mode':'evaluate','model':'pretrained','device':'cpu'});state=wait();assert state['status']=='completed',state
                released=requests.post(base+'/activate',json={'model':normal},headers=headers,timeout=10)
                summary=call('/improvement')
                report={'standaloneCopy':True,'practiceTraining':'completed','practiceActivationRejected':True,'normalTraining':'completed',
                        'evaluationKeys':sorted(evaluation),'exactRate':evaluation['exactItemAndCountRate'],'gateWithoutBaselineRejected':True,
                        'activationAfterBaseline':released.status_code,'activationMessage':released.json().get('note') or released.json().get('error'),
                        'suggestions':len(summary['suggestions'])}
                print(json.dumps(report,ensure_ascii=False),flush=True)
            finally:
                try:requests.post(base+'/stop',json={},headers=headers,timeout=20)
                except requests.RequestException:pass
                process.terminate();process.wait(timeout=20)
                if process.returncode not in (0,1,-15,15) and (root/'server.log').exists():print((root/'server.log').read_text(encoding='utf-8')[-3000:])

if __name__=='__main__':main()
