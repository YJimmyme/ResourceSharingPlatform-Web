import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Roles, roleDisplayName } from '../lib/enums'
import { supabase } from '../lib/supabaseClient'
import { functionErrorMessage } from '../lib/functionError'
import { attachSharedAiPhoto } from '../lib/imageUpload'
import { logActivity } from '../lib/activityLog'
import { EXPIRY_WARNING_DAYS } from '../lib/stockBatch'
import type { AIStockInLog, SupplyItem, SupplyLocation, SupplyTransferLog } from '../types/db'
import './mobile-original.css'

// [path, icon, title, description, requiresManage]. requiresManage=true means
// the tile is only enabled for Admin/Cadre. 查詢/領用/影像入庫 are open to all
// roles; only 物資轉讓 stays cadre-and-up. (捐贈/報廢 stay desktop-only; the
// LINE menu deliberately doesn't carry them.)
const features = [
  ['/mobile/inventory', '⌕', '物資查詢', '查看目前可用庫存與效期', false],
  ['/mobile/pickup', '▣', '物資領用', '快到期物資優先領用', false],
  ['/mobile/transfer', '⇄', '物資轉讓', '據點間轉移與到貨確認', true],
  ['/mobile/vision', '▧', '影像入庫', '拍照辨識並核對入庫', false],
] as const

function useMobileData() {
  const { profile } = useAuth()
  const [items, setItems] = useState<SupplyItem[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [loading, setLoading] = useState(true)
  async function load() {
    setLoading(true)
    const [a, b] = await Promise.all([
      supabase.from('supply_item').select('*').eq('is_active', true).gt('quantity', 0).order('expiration_date'),
      supabase.from('supply_location').select('*').eq('is_active', true).order('id'),
    ])
    setItems((a.data ?? []) as SupplyItem[]); setLocations((b.data ?? []) as SupplyLocation[]); setLoading(false)
  }
  useEffect(() => { void load() }, [])
  return { profile, items, locations, loading, load }
}

function MobileTop({ eyebrow, title, meta, refresh }: { eyebrow?: string; title: string; meta: string; refresh?: () => void }) {
  return <header className="m-hero"><div>{eyebrow && <div className="m-eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{meta}</p></div>{refresh && <button className="m-refresh" onClick={refresh} aria-label="重新整理">↻</button>}</header>
}
function expiryState(x: SupplyItem) { if (!x.expiration_date) return 'normal'; const days = Math.ceil((new Date(x.expiration_date).getTime() - Date.now()) / 86400000); return days < 0 ? 'expired' : days <= EXPIRY_WARNING_DAYS ? 'expiring' : 'normal' }
function expiryText(x: SupplyItem) { const s = expiryState(x); return !x.expiration_date ? '無效期' : s === 'expired' ? `已過期 ${x.expiration_date}` : s === 'expiring' ? `快過期 ${x.expiration_date}` : `效期 ${x.expiration_date}` }
function ItemCard({ item, selected, onClick }: { item: SupplyItem; selected?: boolean; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div'; const state = expiryState(item)
  return <Tag className={`m-item ${state} ${selected ? 'selected' : ''}`} onClick={onClick}><div><div className="m-item-name">{item.item_name}<span>{item.category}</span></div><div className="m-details">{item.specification || '一般規格'} · <b className={state}>{expiryText(item)}</b></div></div><div className="m-quantity">{item.quantity} {item.unit}</div></Tag>
}

// Shown full-screen when a signed-in user opens a LINE rich-menu URL for a
// feature their role can't use (e.g. a SocialWorker tapping 物資轉讓/影像入庫).
export function MobileNoAccess() {
  const { profile } = useAuth()
  return (
    <div className="mobile-page">
      <MobileTop eyebrow="LINE 圖文選單" title="無法使用此功能" meta={`目前角色：${roleDisplayName(profile?.role_name)}`} />
      <div className="m-empty">
        您的帳號角色無法使用此功能。
        <br />
        如需使用，請聯絡系統管理員調整權限。
      </div>
    </div>
  )
}

export function MobileFeatures() {
  const { profile } = useAuth(); const canManage = [Roles.Admin, Roles.Cadre].includes(profile?.role_name as never)
  return <div className="mobile-page m-menu"><MobileTop eyebrow="LINE 圖文選單" title="手機網頁功能" meta="請選擇要使用的功能" />
    <div className="m-feature-grid">{features.map(([path, icon, title, desc, requiresManage]) => { const denied = requiresManage && !canManage; return <div className={`m-feature ${denied ? 'disabled' : ''}`} key={path}><div className="m-feature-icon">{icon}</div><h2>{title}</h2><p>{desc}</p>{denied ? <button disabled>目前角色不可使用</button> : <Link to={path}>開啟功能</Link>}</div> })}</div>
  </div>
}

export function MobileInventory() {
  const { profile, items, locations, loading, load } = useMobileData(); const [keyword, setKeyword] = useState(''); const [filter, setFilter] = useState('all')
  const locationId = profile?.location_id; const rows = useMemo(() => items.filter(x => (!locationId || x.location_id === locationId) && (filter === 'all' || expiryState(x) === filter) && `${x.item_name} ${x.category} ${x.specification ?? ''}`.toLowerCase().includes(keyword.toLowerCase())), [items, locationId, filter, keyword])
  const site = locations.find(x => x.id === locationId)?.location_name ?? '全部可見據點'
  return <div className="mobile-page"><MobileTop eyebrow="目前可用庫存" title="物資查詢" meta={site} refresh={() => void load()} /><section className="m-toolbar"><label className="m-search">⌕<input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="搜尋物資名稱" /></label><div className="m-filters">{[['all','全部'],['expired','已過期'],['expiring','快過期'],['normal','一般']].map(([v,t]) => <button className={filter === v ? 'active' : ''} onClick={() => setFilter(v)} key={v}>{t}</button>)}</div></section><div className="m-summary">{loading ? '讀取中…' : `共 ${rows.length} 項物資`}</div><section className="m-list">{rows.map(x => <ItemCard item={x} key={x.id} />)}</section>{!loading && !rows.length && <div className="m-empty">找不到符合條件的物資。</div>}</div>
}

export function MobilePickup() {
  const { profile, items, locations, load } = useMobileData(); const [keyword, setKeyword] = useState(''); const [selected, setSelected] = useState<SupplyItem | null>(null); const [open, setOpen] = useState(false); const [name, setName] = useState(''); const [contact, setContact] = useState(''); const [qty, setQty] = useState(1); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('')
  const rows = items.filter(x => (!profile?.location_id || x.location_id === profile.location_id) && `${x.item_name} ${x.category}`.toLowerCase().includes(keyword.toLowerCase())); const site = locations.find(x => x.id === profile?.location_id)?.location_name ?? '可用據點'
  async function submit(e: FormEvent) { e.preventDefault(); if (!selected || !profile?.location_id) return; setBusy(true); const { data, error } = await supabase.functions.invoke('outbound-create', { body: { supplyItemId: selected.id, locationId: profile.location_id, outboundQuantity: qty, recipientName: name, recipientContact: contact, remark: '' } }); setBusy(false); if (error || !data?.success) return setMessage(data?.message ?? error?.message ?? '領用失敗'); void logActivity({ action: 'outbound', category: '庫存異動', targetTable: 'supply_outbound_log', locationId: profile.location_id, summary: `手機領用「${selected.item_name}」${qty} ${selected.unit ?? ''}（使用人 ${name}）` }); setMessage(data.message); setOpen(false); setSelected(null); setName(''); await load() }
  return <div className="mobile-page with-dock"><MobileTop eyebrow="由快到期物資優先" title="物資領用" meta={site} refresh={() => void load()} />{message && <div className="m-banner">{message}</div>}<section className="m-toolbar"><label className="m-search">⌕<input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="搜尋要領用的物資" /></label></section><div className="m-summary">{selected ? `已選擇：${selected.item_name}` : '請先選擇一項物資'}</div><section className="m-list">{rows.map(x => <ItemCard item={x} selected={selected?.id === x.id} onClick={() => setSelected(x)} key={x.id} />)}</section><div className="m-dock"><span>{selected ? `${selected.item_name} · ${selected.quantity} ${selected.unit}` : '尚未選擇物資'}</span><button disabled={!selected} onClick={() => { setQty(1); setOpen(true) }}>設定領用數量</button></div>{open && selected && <div className="m-modal"><button className="m-backdrop" onClick={() => setOpen(false)} /><form className="m-sheet" onSubmit={submit}><div className="m-handle"/><h2>確認領用</h2><div className="m-chosen">{selected.item_name} · 可用 {selected.quantity} {selected.unit}</div><label>使用人姓名 <b>*</b></label><input required maxLength={50} value={name} onChange={e => setName(e.target.value)} placeholder="必填"/><label>聯絡方式</label><input maxLength={50} value={contact} onChange={e => setContact(e.target.value)} placeholder="選填"/><label>領用數量</label><div className="m-qty"><button type="button" onClick={() => setQty(Math.max(1, qty-1))}>−</button><input type="number" min={1} max={selected.quantity} value={qty} onChange={e => setQty(Number(e.target.value))}/><button type="button" onClick={() => setQty(Math.min(selected.quantity, qty+1))}>＋</button></div><small>最多可領用 {selected.quantity} {selected.unit}</small><div className="m-sheet-actions"><button type="button" onClick={() => setOpen(false)}>取消</button><button disabled={busy}>{busy ? '處理中…' : '確認領用'}</button></div></form></div>}</div>
}

// 待確認轉入清單（轉入本據點、還沒確認的轉移）。建立／確認之後都要重讀，
// 不能只在畫面上把該筆濾掉 —— 濾掉會讓失敗的操作看起來像成功。
//
// 這裡只有「確認」沒有「取消」：取消已改綁轉出單位（見 Markdown/Feature-SupplyTransfer.md），
// 這份清單站在轉入方，按了一定會被 transfer-cancel 擋下來。要取消請到桌面版的轉移紀錄頁。
async function fetchPendingTransfers(toLocationId: number | null | undefined) {
  if (!toLocationId) return []
  const { data } = await supabase.from('supply_transfer_log').select('*').eq('to_location_id', toLocationId).eq('status', 'Pending').order('transfer_time')
  return (data ?? []) as SupplyTransferLog[]
}

export function MobileTransfer() {
  const { profile, items, locations, load } = useMobileData(); const [step, setStep] = useState(1); const [to, setTo] = useState<number|null>(null); const [item, setItem] = useState<SupplyItem|null>(null); const [qty, setQty] = useState(1); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const [pending,setPending]=useState<SupplyTransferLog[]>([])
  const from = profile?.location_id; const sourceItems = items.filter(x => x.location_id === from); const siteName=(id:number|null|undefined)=>locations.find(x=>x.id===id)?.location_name ?? '—'
  useEffect(()=>{void fetchPendingTransfers(from).then(setPending)},[from])
  // 確認／取消一律以伺服器回應為準。舊版無論成功與否都把該筆從待確認清單移除、
  // 且只重新讀取庫存不重新讀取待確認清單，所以 Edge Function 失敗時畫面看起來
  // 像是處理完成，實際上來源庫存沒退回、目標庫存也沒加總。錯誤訊息要走
  // functionErrorMessage：supabase-js 會把非 2xx 的內容換成 "non-2xx status code"，
  // 真正的中文原因藏在 response body 裡。
  async function resolve(fn:'transfer-confirm'|'transfer-cancel',id:number){setBusy(true);const{data,error}=await supabase.functions.invoke(fn,{body:{logId:id}});setBusy(false);if(error||!data?.success){setMessage(data?.message??await functionErrorMessage(error,fn==='transfer-confirm'?'確認失敗':'取消失敗'));return}setMessage(data.message);await Promise.all([load(),fetchPendingTransfers(from).then(setPending)])}
  async function submit(){if(!from||!to||!item)return;setBusy(true);const{data,error}=await supabase.functions.invoke('transfer-create',{body:{fromLocationId:from,toLocationId:to,lines:[{supplyItemId:item.id,transferQuantity:qty}],remark:''}});setBusy(false);if(error||!data?.success){setMessage(data?.message??await functionErrorMessage(error,'建立失敗'));return}void logActivity({action:'transfer_create',category:'庫存異動',targetTable:'supply_transfer_log',locationId:from??null,summary:`手機轉移「${item.item_name}」${qty} ${item.unit??''}`});setMessage(data.message);setStep(1);setTo(null);setItem(null);setQty(1);await Promise.all([load(),fetchPendingTransfers(from).then(setPending)])}
  const next=()=>{if(step===1&&!to)return setMessage('請選擇目標據點');if(step===2&&!item)return setMessage('請選擇品項');if(step===4)return void submit();setMessage('');setStep(x=>Math.min(4,x+1))}
  return <div className="mobile-page transfer with-dock"><header className="m-topbar"><h1>🔄 物資轉讓</h1><p>{siteName(from)} · {profile?.display_name ?? profile?.username}</p></header>{message&&<div className="m-banner">{message}</div>}{pending.length>0&&<section className="m-panel pending"><h3>待確認轉入</h3>{pending.map(x=><div className="m-pending" key={x.id}><span>物資 #{x.supply_item_id}<small>{x.transfer_quantity} 件 · 來自 {siteName(x.from_location_id)}</small></span><div><button disabled={busy} onClick={()=>void resolve('transfer-confirm',x.id)}>確認</button></div></div>)}</section>}<nav className="m-steps">{['1 據點','2 品項','3 數量','4 確認'].map((x,i)=><button className={step===i+1?'active':step>i+1?'done':''} onClick={()=>i+1<step&&setStep(i+1)} key={x}>{x}</button>)}</nav>{step===1&&<><section className="m-panel"><small>從（您的據點）</small><strong>{siteName(from)}</strong></section><h3 className="m-section-title">選擇目標據點</h3><div className="m-options">{locations.filter(x=>x.id!==from).map(x=><button className={to===x.id?'selected':''} onClick={()=>setTo(x.id)} key={x.id}><strong>{x.location_name}</strong><span>{x.address||'未設定地址'}</span></button>)}</div></>}{step===2&&<><h3 className="m-section-title">選擇要轉出的品項</h3><div className="m-options">{sourceItems.map(x=><button className={item?.id===x.id?'selected':''} onClick={()=>setItem(x)} key={x.id}><strong>{x.item_name}</strong><span>{x.specification||'一般規格'} · 可轉 {x.quantity} {x.unit}</span></button>)}</div></>}{step===3&&item&&<section className="m-panel"><strong>{item.item_name} → {siteName(to)}</strong><label>轉讓數量</label><div className="m-qty"><button onClick={()=>setQty(Math.max(1,qty-1))}>−</button><input type="number" min={1} max={item.quantity} value={qty} onChange={e=>setQty(Math.min(item.quantity,Math.max(1,Number(e.target.value))))}/><button onClick={()=>setQty(Math.min(item.quantity,qty+1))}>＋</button></div><small>可轉庫存：{item.quantity} {item.unit}</small></section>}{step===4&&item&&<section className="m-panel"><h3>請確認轉讓內容</h3><dl><dt>來源據點</dt><dd>{siteName(from)}</dd><dt>目標據點</dt><dd>{siteName(to)}</dd><dt>物資</dt><dd>{item.item_name}</dd><dt>數量</dt><dd>{qty} {item.unit}</dd></dl></section>}<div className="m-dock two"><button disabled={step===1||busy} onClick={()=>setStep(x=>x-1)}>上一步</button><button disabled={busy} onClick={next}>{busy?'處理中…':step===4?'確認轉讓':'下一步'}</button></div></div>
}

export function MobileVision() {
  const { profile, locations } = useMobileData(); const fileRef=useRef<HTMLInputElement>(null); const cameraRef=useRef<HTMLInputElement>(null); const [file,setFile]=useState<File|null>(null); const [preview,setPreview]=useState<string|null>(null); const [logs,setLogs]=useState<AIStockInLog[]>([]); const [tab,setTab]=useState('no_expiry'); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const locationId=profile?.location_id; const site=locations.find(x=>x.id===locationId)?.location_name??'未指定據點'
  async function recognize(f:File){if(!locationId)return setMessage('帳號尚未指定據點');setFile(f);setPreview(URL.createObjectURL(f));setBusy(true);const ext=f.name.split('.').pop()?.toLowerCase()||'jpg';const path=`${profile?.id}/${crypto.randomUUID()}.${ext}`;const up=await supabase.storage.from('ai-stockin').upload(path,f);if(up.error){setBusy(false);return setMessage(up.error.message)}const{data,error}=await supabase.functions.invoke('ai-stockin-recognize',{body:{locationId,imagePath:path}});setBusy(false);if(error||!data?.success)return setMessage(data?.message??await functionErrorMessage(error,'辨識失敗'));setLogs(data.logs??[data.log]);setMessage(data.message)}
  const group=(x:AIStockInLog)=>x.suggested_stock_type==='NoExpiry'?'no_expiry':x.suggested_stock_type==='Frozen'?'frozen':'expiring';const visible=logs.filter(x=>group(x)===tab);const update=(id:number,p:Partial<AIStockInLog>)=>setLogs(xs=>xs.map(x=>x.id===id?{...x,...p}:x))
  async function confirm(){setBusy(true);const confirmed:{id:number;quantity:number}[]=[];const aiPath=logs[0]?.input_image_path??null;for(const x of logs){const{data,error}=await supabase.functions.invoke('ai-stockin-confirm',{body:{logId:x.id,locationId,category:x.suggested_category,itemName:x.suggested_item_name,specification:x.suggested_specification,quantity:x.suggested_quantity,unit:x.suggested_unit,stockType:x.suggested_stock_type,expirationDate:x.suggested_expiration_date,safetyStock:x.suggested_safety_stock,remark:x.suggested_remark}});if(error||!data?.success){setBusy(false);return setMessage(data?.message??await functionErrorMessage(error,'入庫失敗'))}if(data.item?.id){confirmed.push({id:data.item.id,quantity:data.item.quantity});await supabase.from('supply_stock_in_log').insert({supply_item_id:data.item.id,location_id:locationId,stock_in_quantity:data.item.quantity,operator:profile?.display_name??profile?.username??null,remark:'AI 智慧入庫'})}}await attachSharedAiPhoto(aiPath,confirmed);void logActivity({action:'ai_stock_in',category:'庫存異動',targetTable:'supply_item',locationId:locationId??null,summary:`AI 影像入庫確認，共 ${confirmed.length} 項`});setBusy(false);setLogs([]);setFile(null);setPreview(null);setMessage(`本批物資已確認入庫，共 ${confirmed.length} 項`)}
  const choose=(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(f)void recognize(f)}
  return <div className="mobile-page vision with-dock"><header className="m-topbar"><h1>📷 影像入庫</h1><p>{site} · {profile?.display_name??profile?.username}</p></header>{message&&<div className="m-banner">{message}</div>}<section className="m-panel"><button className="m-upload" onClick={()=>fileRef.current?.click()}><strong>{file?file.name:'點這裡上傳物資照片'}</strong><span>建議單層擺放、標籤朝鏡頭。<br/>可連續拍多張，系統會自動加總。</span></button><div className="m-upload-actions"><button onClick={()=>cameraRef.current?.click()}>開啟相機</button><button onClick={()=>fileRef.current?.click()}>相簿選擇</button></div><input hidden ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={choose}/><input hidden ref={fileRef} type="file" accept="image/*" onChange={choose}/>{preview&&<div style={{textAlign:'center',marginTop:12}}><img src={preview} alt="辨識照片" style={{maxWidth:'100%',maxHeight:220,objectFit:'contain',borderRadius:8}}/></div>}<p style={{marginTop:12,fontSize:13,textAlign:'center',color:'#6b7280'}}>辨識不出來（單一或批次都失敗）？<Link to="/stock-in" style={{fontWeight:600}}>改用網頁手動輸入 →</Link></p></section>{logs.length>0&&<nav className="m-tabs">{[['no_expiry','無效期物資'],['expiring','有效期物資'],['frozen','冷凍食品']].map(([v,t])=><button className={tab===v?'active':''} onClick={()=>setTab(v)} key={v}>{t} <b>{logs.filter(x=>group(x)===v).length}</b></button>)}</nav>}{!logs.length?<div className="m-empty">{busy?'AI 辨識處理中…':'上傳照片後，這裡會列出可編輯的物資資料。'}</div>:visible.map((x,i)=><section className="m-panel m-reco" key={x.id}><div className="m-reco-head"><small>辨識項目 {i+1}</small><button onClick={()=>setLogs(xs=>xs.filter(y=>y.id!==x.id))}>移除</button></div><label>物資名稱 *</label><input value={x.suggested_item_name??''} onChange={e=>update(x.id,{suggested_item_name:e.target.value})}/><div className="m-grid"><div><label>數量 *</label><input type="number" min={1} value={x.suggested_quantity??1} onChange={e=>update(x.id,{suggested_quantity:Number(e.target.value)})}/></div><div><label>單位 *</label><input value={x.suggested_unit??'個'} onChange={e=>update(x.id,{suggested_unit:e.target.value})}/></div></div>{group(x)!=='no_expiry'&&<><label>有效期限</label><input type="date" min="2000-01-01" max="2100-12-31" value={x.suggested_expiration_date??''} onChange={e=>update(x.id,{suggested_expiration_date:e.target.value})}/></>}</section>)}<div className="m-dock two"><button onClick={()=>{setLogs([]);setFile(null);setPreview(null);setMessage('')}}>清除本批</button><button disabled={!logs.length||busy} onClick={()=>void confirm()}>{busy?'處理中…':'確認入庫'}</button></div></div>
}
