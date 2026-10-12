import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appearanceItems} from './appearance.mjs';
import {runPipeline} from './pipeline.mjs';
test('箱瓶不合併，未知數量不轉1，同品項合併',()=>{const result=appearanceItems({items:[{name:'水',quantity:2,unit:'瓶'},{name:'水',quantity:1,unit:'箱'},{name:'水',quantity:3,unit:'瓶'},{name:'衛生紙',quantity:null,unit:'包'}]});assert.equal(result[0].quantity,5);assert.equal(result[1].quantity,1);assert.equal(result[2].quantity,null);});
test('外觀模式不讀字、不套用目錄單位；只評品名數量',async()=>{const calls=[];const result=await runPipeline({mode:'combined',goal:'appearance',image:'photo',ocr:true,crop:false,review:false,catalog:[{item_name:'水',unit:'瓶'}],synonyms:[],expected:[{item_name:'水',quantity:1,unit:'瓶'}]},{call:async x=>{calls.push(x);return {raw:'{"items":[{"name":"水","quantity":1,"unit":"箱"}]}'};},cropImage:async()=>''});assert.equal(calls.length,1);assert.equal(result.items[0].unit,'箱');assert.equal(result.score.exact,1);assert.equal(result.score.fields.unit.total,0);assert.ok(calls[0].prompt.includes('不要推算箱內瓶數'));});
