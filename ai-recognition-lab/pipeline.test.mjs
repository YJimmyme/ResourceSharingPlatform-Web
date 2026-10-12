import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runPipeline,cleanBoxes,selectRoute} from './pipeline.mjs';
const b={mode:'combined',complexity:'complex',simpleModel:'simple',complexModel:'complex',reviewModel:'review',textModel:'text',crop:true,ocr:true,review:true,image:'original',catalog:[{item_name:'泡麵',unit:'杯',category:'食品'}],synonyms:[],expected:[{item_name:'泡麵',quantity:2,unit:'杯'}]};
test('難度選擇改變模型；基準版本不啟動組合功能',()=>{assert.equal(selectRoute(b).model,'complex');assert.equal(selectRoute({...b,complexity:'simple'}).model,'simple');assert.equal(selectRoute({...b,mode:'baseline'}).crop,false);});
test('座標校驗、裁切上限與無效框排除',()=>{assert.deepEqual(cleanBoxes({boxes:[{box:[-.1,0,2,1]},{box:[.8,0,.2,1]},{box:[0,0,1,'x']}]}).map(x=>x.box),[[0,0,1,1]]);});
test('整圖＋局部＋文字證據＋另一模型複核；答案只在最後評分',async()=>{
 const calls=[];const outputs=[{boxes:[{box:[.1,.1,.5,.5]}]},{labels:[{text:'來一客'}]},{items:[{name:'泡麵',quantity:1}]},{items:[{name:'泡麵',quantity:2,confidence:.9}]}];
 const result=await runPipeline(b,{call:async x=>{calls.push(x);assert.ok(!x.prompt.includes('expected'));return {raw:JSON.stringify(outputs.shift())};},cropImage:async()=> 'crop'});
 assert.equal(result.callCount,4);assert.deepEqual(calls[2].images,['original','crop']);assert.equal(calls[3].model,'review');assert.equal(result.items[0].quantity,2);assert.equal(result.score.exact,1);assert.ok(calls[2].prompt.includes('不得重複計數'));
});
test('定位和文字失敗降級；複核失敗保留第一輪',async()=>{
 let i=0;const r=await runPipeline(b,{call:async()=>{i++;if(i===3)return {raw:'{"items":[{"name":"泡麵","quantity":2}]}'};throw Error('offline');},cropImage:async()=>''});
 assert.equal(r.warnings.length,3);assert.equal(r.items[0].quantity,2);
});
test('不確定時複核可跳過正常品項',async()=>{
 let calls=0;const r=await runPipeline({...b,crop:false,ocr:false,reviewPolicy:'uncertain'},{call:async()=>{calls++;return {raw:'{"items":[{"name":"泡麵","quantity":2,"confidence":0.95}]}'};},cropImage:async()=>''});assert.equal(calls,1);assert.equal(r.reviewTriggered,false);
});
