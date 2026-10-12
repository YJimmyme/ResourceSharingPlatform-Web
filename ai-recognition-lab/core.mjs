import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

// 從現有後端直接擷取純函式；測試基準隨目前原始碼更新。
const source = fs.readFileSync(new URL('../supabase/functions/ai-stockin-recognize/index.ts', import.meta.url), 'utf8');
const pure = source.slice(source.indexOf('const CATEGORIES='), source.indexOf('serve(async'))
  .replaceAll(':string[]', '').replaceAll(':string', '').replaceAll(':any', '')
  .replace("throw new E('AI 回覆不是有效 JSON')", "throw new Error('AI 回覆不是有效 JSON')");
const baseline = vm.runInNewContext(`(()=>{${pure};return {prompt,parseJson,normalizeText,stockType,confidenceNumber,CATEGORIES,UNITS,NON_SUPPLY}})()`);
export const sourceHash = createHash('sha256').update(source).digest('hex');
export function makePrompt(catalog, mode) {
  const original = baseline.prompt(catalog.map(x => x.item_name));
  if (mode !== 'prompt') return original;
  return original.replace('quantity 為正整數','quantity 為正整數或 null').replace('不確定數量用 1 並降低 confidence','不確定數量填 null 並降低 confidence') + '\n補充規則：逐項查看物體與包裝標籤。數量只計算可見、可確認的實體，不推測遮擋物或箱內數量。不確定的 quantity 填 null，並在 uncertainty 說明原因。不可用品牌直接推測規格或效期。依目錄選擇標準品名與單位；包裝上的品牌存 raw_name。效期不可用製造日期代替，無法看清時留空。每項另填 confidence（0到1）。\n完整測試目錄：' + JSON.stringify(catalog);
}
export function normalize(parsed, catalog, synonyms, mode) {
  const norm=baseline.normalizeText;
  const defs=new Map(catalog.map(x=>[norm(x.item_name),x]));
  const syns=new Map(synonyms.map(x=>[norm(x.synonym),x.standard_name]));
  return (Array.isArray(parsed.items)?parsed.items:[]).filter(x=>x&&x.name&&!baseline.NON_SUPPLY.some(k=>`${x.name} ${x.raw_name||''}`.toLowerCase().includes(k))).map(x=>{
    const rawName=String(x.raw_name||x.name).trim();
    const name=syns.get(norm(rawName))||syns.get(norm(String(x.name)))||defs.get(norm(String(x.name)))?.item_name||String(x.name).trim();
    const def=defs.get(norm(name));
    const enhanced=mode==='prompt';
    return {item_name:name,raw_name:rawName,
      category:enhanced&&def?def.category:baseline.CATEGORIES.includes(x.category)?x.category:def?.category||'其他',
      quantity:enhanced?(Number.isInteger(x.quantity)&&x.quantity>0?x.quantity:null):Math.max(1,parseInt(x.quantity)||1),
      unit:enhanced&&def?def.unit:baseline.UNITS.includes(x.unit)?x.unit:def?.unit||'個',
      specification:String(x.specification||'').trim()||null,
      stock_type:def?.stock_type||baseline.stockType(x.inventory_type),
      expiration_date:String(x.expiry_date||'').match(/^\d{4}-\d{2}-\d{2}$/)?.[0]||null,
      confidence:baseline.confidenceNumber(enhanced?x.confidence??parsed.confidence:parsed.confidence),
      uncertainty:x.uncertainty||null};
  });
}
export const parseJson=baseline.parseJson;
export function score(items, expected) {
  const used=new Set(); const fields=['quantity','unit','category','specification','expiration_date'];
  const counts=Object.fromEntries(fields.map(f=>[f,{correct:0,total:0}]));
  let matched=0,exact=0;
  const details=expected.map(e=>{
    const i=items.findIndex((x,i)=>!used.has(i)&&x.item_name===e.item_name);
    const found=i>=0?items[i]:null;if(found){used.add(i);matched++;}
    const checks={};
    for(const f of fields)if(Object.hasOwn(e,f)){counts[f].total++;checks[f]=!!found&&(found[f]??null)===(e[f]??null);if(checks[f])counts[f].correct++;}
    if(found&&Object.values(checks).every(Boolean))exact++;
    return {expected:e,actual:found,checks};
  });
  return {expectedCount:expected.length,predictedCount:items.length,matched,exact,
    precision:items.length?matched/items.length:expected.length?0:1,
    recall:expected.length?matched/expected.length:items.length?0:1,
    fields:counts,details,extra:items.filter((_,i)=>!used.has(i))};
}
