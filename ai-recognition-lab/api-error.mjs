export async function apiError(response,apiKey='') {
 let data;try{data=await response.json();}catch{data={};}
 const e=data.error||{},code=String(e.code||e.type||'unknown');
 let detail=String(e.message||'服務未提供詳細原因').slice(0,1500);
 if(apiKey)detail=detail.replaceAll(apiKey,'[金鑰已隱藏]');
 detail=detail.replace(/sk-[A-Za-z0-9_-]+/g,'[金鑰已隱藏]');
 const quota=/quota|billing|balance|credit|spend_limit|usage_limit/.test(code);
 const retry=response.headers.get('retry-after');
 const hint=response.status===429?(quota?'API 額度或帳務限制：請檢查 API 專案的帳務、可用餘額與使用限制。重新建立金鑰或立即重試無法解決額度不足。':`API 頻率或Token限制：請先用A原版單次測試、減少圖片或目錄大小，再依服務提示等待。${retry?' Retry-After：'+retry:''}`):response.status===401?'金鑰無效或未授權，請檢查 API Key。':'請依下方服務訊息檢查模型及參數。';
 const error=new Error(`AI API HTTP ${response.status} [${code}]\n${hint}\nOpenAI：${detail}`);
 error.stopPipeline=[401,403,429].includes(response.status);
 return error;
}
