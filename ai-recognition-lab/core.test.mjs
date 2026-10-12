import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalize,score,makePrompt,parseJson} from './core.mjs';
const catalog=[{item_name:'泡麵',category:'食品',unit:'杯',stock_type:'HasExpiry'}];
test('基準保留原版錯誤單位，改善版使用目錄單位並保留未知數量',()=>{
 const data={items:[{name:'來一客',category:'日用品',unit:'箱',quantity:null}],confidence:'high'};
 const synonyms=[{synonym:'來一客',standard_name:'泡麵'}];
 const a=normalize(data,catalog,synonyms,'baseline')[0],b=normalize(data,catalog,synonyms,'prompt')[0];
 assert.equal(a.quantity,1);assert.equal(a.unit,'箱');assert.equal(a.category,'日用品');
 assert.equal(b.quantity,null);assert.equal(b.unit,'杯');assert.equal(b.category,'食品');
});
test('重複答案不重複計分，漏辨識算錯，額外項目降低精確率',()=>{
 const s=score([{item_name:'泡麵',quantity:2},{item_name:'泡麵',quantity:2}],[{item_name:'泡麵',quantity:2},{item_name:'飲水',quantity:3}]);
 assert.equal(s.matched,1);assert.equal(s.precision,.5);assert.equal(s.recall,.5);assert.equal(s.fields.quantity.correct,1);assert.equal(s.fields.quantity.total,2);
});
test('B只改圖片細節，不改提示詞；解析支援Markdown',()=>{
 assert.equal(makePrompt(catalog,'baseline'),makePrompt(catalog,'detail'));
 assert.equal(parseJson('```json\n{"items":[]}\n```').items.length,0);
});
