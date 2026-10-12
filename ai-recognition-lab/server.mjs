import http from 'node:http';
import fs from 'node:fs';
import sharp from 'sharp';
import {runPipeline} from './pipeline.mjs';
import {apiError} from './api-error.mjs';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const port=Number(process.env.AI_LAB_PORT||5180);
const python=fileURLToPath(new URL(process.platform==='win32'?'./.venv-yolo/Scripts/python.exe':'./.venv-yolo/bin/python',import.meta.url));
let worker;

function stopWorker(){if(worker&&worker.exitCode===null){if(process.platform==='win32')spawnSync('taskkill',['/PID',String(worker.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else worker.kill();worker=undefined;}}
process.on('exit',stopWorker);
process.on('SIGINT',()=>{stopWorker();process.exit();});
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
 if(req.method==='GET'&&req.url==='/yolo'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fs.readFileSync(new URL('../modules/vision/vision_ui/workbench.html',import.meta.url)));}
 if(req.url.startsWith('/yolo-api/')){
  if(req.method==='POST'&&req.headers.origin!==`http://127.0.0.1:${port}`){res.writeHead(403);return res.end();}
  try{let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>64*1024*1024)throw Error('照片過大');}const r=await fetch('http://127.0.0.1:'+(process.env.YOLO_LAB_PORT||5181)+'/'+req.url.slice('/yolo-api/'.length),{method:req.method,headers:{'Content-Type':'application/json',Origin:`http://127.0.0.1:${port}`},body:req.method==='POST'?body:undefined,signal:AbortSignal.timeout(180000)});res.writeHead(r.status,{'Content-Type':r.headers.get('content-type')||'application/json',...(r.headers.get('content-disposition')?{'Content-Disposition':r.headers.get('content-disposition')}:{})});return res.end(Buffer.from(await r.arrayBuffer()));}catch(e){res.writeHead(503,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'YOLO服務尚未就緒或處理失敗，請執行安裝YOLO.cmd並重新啟動。'+e.message}));}
 }
 if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fs.readFileSync(new URL('./index.html',import.meta.url)));}
 if(req.method!=='POST'||req.url!=='/recognize'){res.writeHead(404);return res.end();}
 if(req.headers.origin!==`http://127.0.0.1:${port}`){res.writeHead(403);return res.end('請從本機頁面操作');}
 try{
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>15*1024*1024)throw Error('請使用小於10MB照片');}
  const b=JSON.parse(body);
  if(!b.apiKey)throw Error('請填入 API Key');
  if(!['baseline','detail','prompt','combined'].includes(b.mode))throw Error('未知模式');
  if(!Array.isArray(b.catalog)||!Array.isArray(b.synonyms)||!Array.isArray(b.expected))throw Error('目錄、同義詞與答案需為JSON陣列');
  if(b.catalog.some(x=>!x||typeof x.item_name!=='string')||b.synonyms.some(x=>!x||typeof x.synonym!=='string'||typeof x.standard_name!=='string')||b.expected.some(x=>!x||typeof x.item_name!=='string'))throw Error('請檢查目錄、同義詞與答案欄位');
  if(!b.image&&!b.text?.trim())throw Error('請選照片或輸入描述');
  if(b.image){if(!/^data:image\/(jpeg|png|webp);base64,/.test(b.image))throw Error('僅支援 JPG、PNG、WebP');const bytes=Buffer.from(b.image.split(',')[1],'base64');if(bytes.length>10*1024*1024)throw Error('照片不可超過10MB');const upright=await sharp(bytes,{limitInputPixels:40000000}).rotate().png().toBuffer();b.image='data:image/png;base64,'+upright.toString('base64');}
  const call=async({model,prompt,images,detail})=>{
   const content=[{type:'text',text:prompt},...images.map(url=>({type:'image_url',image_url:{url,detail}}))];
   const tokenKey=/^(gpt-5|o1|o3|o4)/i.test(model)?'max_completion_tokens':'max_tokens';
   const request={model,messages:[{role:'user',content}],[tokenKey]:b.mode==='combined'?3000:1500};
   if(!/^(gpt-5|o1|o3|o4)/i.test(model))request.temperature=.1;
   const start=Date.now();const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${b.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(120000)});
   if(!r.ok)throw await apiError(r,b.apiKey);
   const api=await r.json();const raw=api.choices?.[0]?.message?.content;
   if(typeof raw!=='string')throw Error('模型沒有回傳文字');return {raw,actualModel:api.model,usage:api.usage,elapsedMs:Date.now()-start};
  };
  const cropImage=async(image,box)=>{const bytes=Buffer.from(image.split(',')[1],'base64');const meta=await sharp(bytes).metadata();const left=Math.floor(box[0]*meta.width),top=Math.floor(box[1]*meta.height);const width=Math.min(meta.width-left,Math.ceil((box[2]-box[0])*meta.width)),height=Math.min(meta.height-top,Math.ceil((box[3]-box[1])*meta.height));const out=await sharp(bytes).extract({left,top,width,height}).png().toBuffer();return 'data:image/png;base64,'+out.toString('base64');};
  const result=await runPipeline(b,{call,cropImage});res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(result));
 }catch(e){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:e.message}));}
});
server.on('error',async(error)=>{
 if(error.code==='EADDRINUSE'){
  let isLab=false;
  try{const r=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(2000)});isLab=r.ok&&(await r.text()).includes('<title>AI 入庫辨識測試</title>');}catch{}
  if(isLab){console.log(`測試工具已經啟動，不需要再開一份。\n請直接開啟：http://127.0.0.1:${port}/yolo\n可以關閉這個重複啟動的視窗，保留原本的服務視窗。`);process.exitCode=0;}
  else{console.error(`連接埠 ${port} 已由其他程式使用，測試工具未啟動。請先確認占用程式，再重新啟動。`);process.exitCode=1;}
 }else{console.error(`測試工具啟動失敗：${error.message}`);process.exitCode=1;}
});
server.listen(port,'127.0.0.1',()=>{
 // Bind the web port before spawning Python so duplicate launches leave no extra workers.
 if(fs.existsSync(python)){worker=spawn(python,[fileURLToPath(new URL('./yolo_worker.py',import.meta.url))],{windowsHide:true,stdio:['ignore','inherit','inherit'],env:{...process.env,AI_LAB_PORT:String(port)}});}
 if(worker)worker.on('error',error=>console.error(`YOLO 服務啟動失敗：${error.message}`));
 console.log(`AI 辨識測試：http://127.0.0.1:${port}（不連 Supabase、不寫庫存）`);
 console.log(`YOLO 標註與訓練：http://127.0.0.1:${port}/yolo`);
});
