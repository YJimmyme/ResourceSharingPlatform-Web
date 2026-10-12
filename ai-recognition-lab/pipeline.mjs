import {appearancePrompt,appearanceItems} from './appearance.mjs';
import {makePrompt,parseJson,normalize,score,sourceHash} from './core.mjs';
export function selectRoute(b){
 if(b.mode!=='combined')return {model:b.model||'gpt-4o-mini',detail:b.mode==='detail'?'high':b.imageDetail||'low',crop:false,ocr:false,review:false};
 const complex=b.complexity==='complex';return {model:(complex?b.complexModel:b.simpleModel)||b.model||'gpt-4o-mini',detail:complex?'high':b.imageDetail||'low',crop:!!b.image&&!!b.crop,ocr:b.goal!=='appearance'&&!!b.image&&!!b.ocr,review:!!b.review};
}
export function cleanBoxes(parsed,max=4){return (Array.isArray(parsed.boxes)?parsed.boxes:[]).filter(b=>Array.isArray(b.box)&&b.box.length===4&&b.box.every(Number.isFinite)).map(b=>({label:String(b.label||'標籤'),box:b.box.map(v=>Math.max(0,Math.min(1,v)))})).filter(b=>b.box[2]-b.box[0]>.02&&b.box[3]-b.box[1]>.02).slice(0,max);}
export function reviewIssues(items,catalog){return items.flatMap((x,i)=>{const reasons=[];if(x.quantity===null)reasons.push('數量未知');if(!catalog.some(d=>d.item_name===x.item_name))reasons.push('不在目錄');if(x.confidence<.75)reasons.push('模型信心偏低（非實測正確率）');return reasons.map(reason=>({index:i,reason}));});}
export async function runPipeline(b,{call,cropImage}){
 const route=selectRoute(b),stages=[],warnings=[],crops=[],start=Date.now();let callCount=0;
 const invoke=async(stage,model,prompt,images,detail)=>{callCount++;try{const r=await call({model,prompt,images,detail});const parsed=parseJson(r.raw);stages.push({stage,requestedModel:model,...r});return parsed;}catch(e){e.message=`階段：${stage}；模型：${model}\n${e.message}`;stages.push({stage,requestedModel:model,error:e.message});throw e;}};
 const combined=b.mode==='combined';const appearance=b.goal==='appearance'&&b.mode!=='baseline'&&b.mode!=='detail';
 const normalizeResult=parsed=>appearance?appearanceItems(parsed):normalize(parsed,b.catalog,b.synonyms,combined?'prompt':b.mode);
 const expected=appearance?b.expected.map(x=>({item_name:x.item_name,quantity:x.quantity})):b.expected;
 if(route.crop){try{const located=await invoke('定位',route.model,(appearance?'定位可見獨立物品的完整外觀區域，不讀效期標籤。':'')+'找出物資包裝或標籤适合放大閱讀的區域。只回傳JSON {"boxes":[{"label":"包裝標籤","box":[0.1,0.1,0.4,0.5]}]}。座標是相對整圖0到1比例，依序左、上、右、下。最多4區。不猜測不可見的位置。',[b.image],'high');for(const box of cleanBoxes(located)){crops.push({...box,image:await cropImage(b.image,box.box)});}if(!crops.length)warnings.push('未取得有效區域，改用整圖。');}catch(e){if(e.stopPipeline)throw e;warnings.push('定位或裁切失敗，改用整圖。');}}
 const images=b.image?[b.image,...crops.map(c=>c.image)]:[];let evidence=null;
 if(route.ocr){try{evidence=await invoke('文字讀取',b.textModel||route.model,'只抄錄清晰可見的包裝文字，特別是品牌、容量、規格、製造日期及有效日期。不推測、不把製造日期當效期。第一張是整圖，後續是同圖局部，不是額外物品。只回傳JSON {"labels":[{"text":"可見文字","image_index":0}],"uncertainty":[]}。',images,'high');}catch(e){if(e.stopPipeline)throw e;warnings.push('文字讀取失敗，繼續圖片辨識。');}}
 let prompt=(appearance?appearancePrompt(b.catalog):makePrompt(b.catalog,combined?'prompt':b.mode))+'\n使用者描述：'+(b.text||'');
 if(combined)prompt+='\n第一張為整圖，後面的圖片只是同圖局部放大，不得重複計數。總數以整圖為準，局部只補充外觀資訊，禁止將局部重複當作新物品。';
 if(evidence)prompt+='\n文字讀取結果（可能有誤，須對照圖片）：'+JSON.stringify(evidence);
 let parsed=await invoke('辨識',route.model,prompt,images,route.detail);
 const issues=reviewIssues(normalizeResult(parsed),b.catalog);
 const shouldReview=route.review&&(b.reviewPolicy!=='uncertain'||issues.length>0);
 if(shouldReview){try{parsed=await invoke('複核',b.reviewModel||route.model,prompt+(appearance?'\n只複核外觀品項與可見數量，不讀品牌、規格或效期。':'')+'\n獨立對照圖片檢查漏品項、重複計數、數量、規格、單位及效期，不可因第一輪答案就採信。回傳完整items JSON，不是修改清單。第一輪答案：'+JSON.stringify(parsed),images,'high');}catch(e){if(e.stopPipeline)throw e;warnings.push('複核失敗，保留第一輪答案。');}}
 const items=normalizeResult(parsed);
 return {timestamp:new Date().toISOString(),mode:b.mode,goal:appearance?'appearance':'original-fields',complexity:b.complexity,route,sourceHash,prompt,text:b.text,imageName:b.imageName,catalog:b.catalog,synonyms:b.synonyms,crops,stages,warnings,reviewTriggered:shouldReview,reviewIssues:issues,raw:stages.filter(s=>(s.stage==='辨識'||s.stage==='複核')&&!s.error).at(-1).raw,items,score:score(items,expected),elapsedMs:Date.now()-start,callCount};
}
