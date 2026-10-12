export function appearancePrompt(catalog) {
 return `你是民生物品外觀辨識與計數助手。只辨識照片中可見的品項及數量。以形狀、外包裝及外觀判別，不要求品牌、口味、容量、規格、製造日期或效期。
每個可見的獨立外包裝算一個：3杯泡麵算3杯，2瓶水算2瓶，1個封閉的箱裝水算1箱。不要推算箱內瓶數、包內個數，也不要把圖案或包裝上印的物品當成實物。
先逐個觀察可见物件，辨識品項與外包裝形式，再將同品項、同外包裝單位合併計數。瓶裝水與箱裝水不可合併；不要同時計算箱子與被箱子包住的物品。遮擋、模糊導致數量無法確認時 quantity 填 null，uncertainty 說明原因，不可猜成1。空場景回傳 items=[]。
目錄只作為名稱參考，不得強迫套用不符合外觀或外包裝的名稱與單位。目錄外物品保留可確認的通用品名。不確定品項寫「未知物品」，並說明原因。
只回傳JSON：{"items":[{"name":"泡麵","quantity":3,"unit":"杯","confidence":0.8,"uncertainty":null}]}。confidence 是模型自評，不代表實測正確率。
參考目錄：${JSON.stringify(catalog.map(x=>({item_name:x.item_name,unit:x.unit})))}`;
}
export function appearanceItems(parsed) {
 const groups=new Map();
 for(const x of Array.isArray(parsed.items)?parsed.items:[]){
  if(!x||typeof x.name!=='string'||!x.name.trim())continue;
  const name=x.name.trim(),unit=typeof x.unit==='string'?x.unit.trim():'';
  const quantity=Number.isInteger(x.quantity)&&x.quantity>0?x.quantity:null;
  const confidence=typeof x.confidence==='number'&&Number.isFinite(x.confidence)?Math.max(0,Math.min(1,x.confidence)):null;
  const item={item_name:name,quantity,unit,confidence,uncertainty:x.uncertainty||(!quantity?'可見數量待確認':null)};
  const key=JSON.stringify([name,unit]);const old=groups.get(key);
  if(!old)groups.set(key,item);else{old.quantity=old.quantity!==null&&quantity!==null?old.quantity+quantity:null;old.confidence=old.confidence!==null&&confidence!==null?Math.min(old.confidence,confidence):null;old.uncertainty=[old.uncertainty,item.uncertainty].filter(Boolean).join('；')||null;}
 }
 return [...groups.values()];
}
