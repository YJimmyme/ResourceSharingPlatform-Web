import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AllRoles, roleDisplayName, Roles, type Role } from '../lib/enums'
import { supabase } from '../lib/supabaseClient'
import { logActivity } from '../lib/activityLog'
import type { Profile, SupplyLocation } from '../types/db'

type Form = { id?: string; username: string; displayName: string; password: string; roleName: Role; locationId: number | null; isActive: boolean }
type LineBinding = { profile_id: string; line_user_id: string; line_display_name: string | null; notify_enabled: boolean; bound_at: string }
const emptyForm: Form = { username: '', displayName: '', password: '', roleName: Roles.SocialWorker, locationId: null, isActive: true }

export function AccountManagement() {
  const [profiles, setProfiles] = useState<Profile[]>([]), [locations, setLocations] = useState<SupplyLocation[]>([])
  const [bindings, setBindings] = useState<LineBinding[]>([])
  const [form, setForm] = useState<Form>(emptyForm), [keyword, setKeyword] = useState(''), [roleFilter, setRoleFilter] = useState<Role|''>(''), [locationFilter, setLocationFilter] = useState(''), [statusFilter, setStatusFilter] = useState<''|'active'|'inactive'>(''), [message, setMessage] = useState<{ok:boolean;text:string}|null>(null), [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  // 綁定碼只有 30 秒，不倒數的話管理員根本不知道還剩多久。issuedAt 記下來是為了
  // 算進度條的比例 —— 直接用回傳的 expiresAt 推，Edge Function 之後改秒數也不用動這裡。
  const [bindCode, setBindCode] = useState<{code:string;expiresAt:string;issuedAt:number;username:string}|null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => { if(!bindCode) return; const t = setInterval(() => setNowMs(Date.now()), 250); return () => clearInterval(t) }, [bindCode])
  const bindExpiresMs = bindCode ? new Date(bindCode.expiresAt).getTime() : 0
  const bindSecondsLeft = bindCode ? Math.max(0, Math.ceil((bindExpiresMs - nowMs) / 1000)) : 0
  const bindPercent = bindCode ? Math.max(0, Math.min(100, ((bindExpiresMs - nowMs) / (bindExpiresMs - bindCode.issuedAt)) * 100)) : 0
  async function load() { const [p, l, b] = await Promise.all([supabase.from('profiles').select('*').order('username'), supabase.from('supply_location').select('*').eq('is_active', true).order('id'), supabase.functions.invoke('account-admin',{body:{action:'bindings'}})]); setProfiles((p.data ?? []) as Profile[]); setLocations((l.data ?? []) as SupplyLocation[]); setBindings((b.data?.bindings ?? []) as LineBinding[]) }
  // 近 7 天曾「忘記密碼自助重設」的帳號 → 須注意。
  const recentlyChanged = useMemo(() => profiles.filter((p) => p.password_changed_at && Date.now() - new Date(p.password_changed_at).getTime() < 7 * 86400000), [profiles])
  async function clearPwFlag(p: Profile) {
    await supabase.from('profiles').update({ password_changed_at: null }).eq('id', p.id)
    void logActivity({ action: 'password_flag_clear', category: '資料維護', targetTable: 'profiles', targetId: p.id, summary: `解除「近期改過密碼」提示：${p.username}` })
    await load()
  }
  useEffect(() => { void load() }, [])
  const filtered = useMemo(() => profiles.filter((x) =>
    (!roleFilter || x.role_name === roleFilter) &&
    (!locationFilter || x.location_id === Number(locationFilter)) &&
    (!statusFilter || (statusFilter === 'active' ? x.is_active : !x.is_active)) &&
    `${x.username} ${x.display_name ?? ''}`.toLowerCase().includes(keyword.toLowerCase())
  ), [profiles, keyword, roleFilter, locationFilter, statusFilter])
  function resetFilters(){setKeyword('');setRoleFilter('');setLocationFilter('');setStatusFilter('')}
  async function submit(e: FormEvent) { e.preventDefault(); setSaving(true); setMessage(null); const isUpdate = !!form.id; const { data, error } = await supabase.functions.invoke('account-admin', { body: { action: form.id ? 'update' : 'create', ...form } }); setSaving(false); if (error || !data?.success) setMessage({ok:false,text:data?.message ?? error?.message ?? '儲存失敗'}); else { void logActivity({ action: isUpdate ? 'account_update' : 'account_create', category: '資料維護', targetTable: 'profiles', targetId: form.id || null, summary: `${isUpdate ? '修改' : '新增'}帳號「${form.username}」（${roleDisplayName(form.roleName)}）` }); setMessage({ok:true,text:data.message}); setForm(emptyForm); setShowForm(false); await load() } }
  function openCreate() { setForm(emptyForm); setShowPassword(false); setShowForm(true) }
  function edit(x: Profile) { setForm({ id:x.id, username:x.username, displayName:x.display_name ?? '', password:'', roleName:x.role_name, locationId:x.location_id, isActive:x.is_active }); setShowPassword(false); setShowForm(true) }
  async function deactivate(x: Profile) { if(!confirm(`確定停用帳號「${x.username}」嗎？停用後該帳號將無法登入。`))return; setSaving(true); setMessage(null); const{data,error}=await supabase.functions.invoke('account-admin',{body:{action:'update',id:x.id,username:x.username,displayName:x.display_name??'',password:'',roleName:x.role_name,locationId:x.location_id,isActive:false}}); setSaving(false); setMessage({ok:!!data?.success,text:data?.message??error?.message??'停用失敗'}); if(data?.success){void logActivity({action:'account_deactivate',category:'資料維護',targetTable:'profiles',targetId:x.id,summary:`停用帳號「${x.username}」`});await load()} }
  async function lineAction(action:'createBindCode'|'unbind',id:string){setSaving(true);const{data,error}=await supabase.functions.invoke('account-admin',{body:{action,id}});setSaving(false)
    // 產生綁定碼成功時不重複顯示一般訊息 —— 底下有專屬的倒數卡片，訊息會變成兩份。
    if(action==='createBindCode'&&data?.success&&data.code){setMessage(null);setBindCode({code:data.code,expiresAt:data.expiresAt,issuedAt:Date.now(),username:profiles.find(p=>p.id===id)?.username??''});setNowMs(Date.now());return}
    setBindCode(null);setMessage({ok:!!data?.success,text:data?.message??error?.message??'LINE 綁定操作失敗'});if(data?.success)await load()}
  return <div className="container-fluid mt-4"><div className="d-flex justify-content-between align-items-center"><h2><i className="bi bi-people" /> 帳號管理</h2><button className="btn btn-primary" onClick={openCreate}><i className="bi bi-person-plus" /> 新增帳號</button></div><hr />
    {message && <div className={`alert alert-${message.ok?'success':'danger'}`}>{message.text}</div>}
    {recentlyChanged.length > 0 && (
      <div className="card border-warning mb-3">
        <div className="card-header bg-warning-subtle text-dark"><i className="bi bi-shield-exclamation" /> 須注意：近 7 天曾自助重設密碼（{recentlyChanged.length}）— 請確認是否為本人操作</div>
        <div className="table-responsive"><table className="table table-sm mb-0 align-middle">
          <thead className="table-light"><tr><th>帳號</th><th>名稱</th><th>角色</th><th>改密碼時間</th><th className="text-end">處理</th></tr></thead>
          <tbody>{recentlyChanged.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.username}</strong></td>
              <td>{p.display_name ?? '—'}</td>
              <td>{roleDisplayName(p.role_name)}</td>
              <td className="col-min">{p.password_changed_at ? new Date(p.password_changed_at).toLocaleDateString('zh-TW') : '—'}</td>
              <td className="text-end text-nowrap">
                <button className="btn btn-sm btn-outline-secondary" onClick={() => void clearPwFlag(p)}><i className="bi bi-check2" /> 設為正常</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="card-footer small text-muted">此提示 7 天後會自動消失；確認無誤可按「設為正常」提前解除。</div>
      </div>
    )}
    {bindCode && <div className={`alert ${bindSecondsLeft>0?'alert-warning':'alert-secondary'} d-flex align-items-center gap-3 flex-wrap`}>
      <div className="text-center">
        <div className="small text-muted">LINE 綁定碼{bindCode.username && `（${bindCode.username}）`}</div>
        <div className="fs-1 fw-bold font-monospace" style={{letterSpacing:'0.2em'}}>{bindCode.code}</div>
      </div>
      <div className="flex-grow-1" style={{minWidth:240}}>
        {bindSecondsLeft>0 ? <>
          請在 <strong className="fs-4">{bindSecondsLeft}</strong> 秒內於 LINE 傳送「<strong>綁定 {bindCode.code}</strong>」
          <div className="progress mt-2" style={{height:8}}><div className={`progress-bar ${bindSecondsLeft<=10?'bg-danger':'bg-warning'}`} style={{width:`${bindPercent}%`}} /></div>
        </> : <span className="text-danger fw-bold"><i className="bi bi-x-circle" /> 綁定碼已過期，請重新產生。</span>}
      </div>
      <button type="button" className="btn-close" aria-label="關閉" onClick={()=>setBindCode(null)} />
    </div>}
    {showForm && <div className="modal d-block" tabIndex={-1} style={{backgroundColor:'rgba(0,0,0,0.5)'}}><div className="modal-dialog modal-lg"><div className="modal-content"><form onSubmit={submit}>
      <div className="modal-header"><h5 className="modal-title">{form.id ? '編輯帳號' : '新增帳號'}</h5><button type="button" className="btn-close" onClick={()=>setShowForm(false)}/></div>
      <div className="modal-body"><div className="row g-3">
      <div className="col-md-6"><label className="form-label">帳號 *</label><input className="form-control" required disabled={!!form.id} value={form.username} onChange={(e)=>setForm({...form,username:e.target.value})}/></div>
      <div className="col-md-6"><label className="form-label">顯示名稱</label><input className="form-control" value={form.displayName} onChange={(e)=>setForm({...form,displayName:e.target.value})}/></div>
      <div className="col-md-6"><label className="form-label">{form.id?'新密碼（留空不變）':'密碼 *'}</label><div className="input-group"><input type={showPassword?'text':'password'} className="form-control" required={!form.id} minLength={6} value={form.password} onChange={(e)=>setForm({...form,password:e.target.value})}/><button type="button" className="btn btn-outline-secondary" tabIndex={-1} onClick={()=>setShowPassword(v=>!v)} title={showPassword?'隱藏密碼':'顯示密碼'}><i className={`bi ${showPassword?'bi-eye-slash':'bi-eye'}`}/></button></div></div>
      <div className="col-md-6"><label className="form-label">角色 *</label><select className="form-select" value={form.roleName} onChange={(e)=>setForm({...form,roleName:e.target.value as Role})}>{AllRoles.map(x=><option key={x} value={x}>{roleDisplayName(x)}</option>)}</select></div>
      <div className="col-md-6"><label className="form-label">所屬據點</label><select className="form-select" value={form.locationId ?? ''} onChange={(e)=>setForm({...form,locationId:e.target.value?Number(e.target.value):null})}><option value="">未指定</option>{locations.map(x=><option key={x.id} value={x.id}>{x.location_name}</option>)}</select></div>
      <div className="col-md-6 d-flex align-items-end"><div className="form-check form-switch mb-2"><input className="form-check-input" type="checkbox" checked={form.isActive} onChange={(e)=>setForm({...form,isActive:e.target.checked})}/><label className="form-check-label">啟用</label></div></div>
      </div></div>
      <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={()=>setShowForm(false)}>取消</button><button className="btn btn-primary" disabled={saving}>{saving?'儲存中…':'儲存帳號'}</button></div>
    </form></div></div></div>}
    <div className="card shadow-sm mb-3"><div className="card-header bg-light"><i className="bi bi-funnel" /> 篩選條件</div><div className="card-body"><div className="row g-3">
      <div className="col-md-3"><label className="form-label">關鍵字</label><input className="form-control" placeholder="搜尋帳號或顯示名稱" value={keyword} onChange={(e)=>setKeyword(e.target.value)}/></div>
      <div className="col-md-3"><label className="form-label">角色</label><select className="form-select" value={roleFilter} onChange={(e)=>setRoleFilter(e.target.value as Role|'')}><option value="">全部角色</option>{AllRoles.map(x=><option key={x} value={x}>{roleDisplayName(x)}</option>)}</select></div>
      <div className="col-md-3"><label className="form-label">據點</label><select className="form-select" value={locationFilter} onChange={(e)=>setLocationFilter(e.target.value)}><option value="">全部據點</option>{locations.map(x=><option key={x.id} value={x.id}>{x.location_name}</option>)}</select></div>
      <div className="col-md-2"><label className="form-label">狀態</label><select className="form-select" value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value as ''|'active'|'inactive')}><option value="">全部</option><option value="active">啟用</option><option value="inactive">停用</option></select></div>
      <div className="col-md-1 d-flex align-items-end"><button type="button" className="btn btn-secondary w-100" onClick={resetFilters} title="重設"><i className="bi bi-arrow-clockwise" /></button></div>
    </div></div></div>
    <div className="card shadow-sm"><div className="card-body"><div className="table-responsive"><table className="table table-hover"><thead><tr><th>帳號</th><th>名稱</th><th>角色</th><th>據點</th><th>LINE 綁定</th><th>狀態</th><th /></tr></thead><tbody>{filtered.map(x=>{const binding=bindings.find(b=>b.profile_id===x.id);return <tr key={x.id}><td>{x.username}</td><td>{x.display_name}</td><td>{roleDisplayName(x.role_name)}</td><td>{locations.find(l=>l.id===x.location_id)?.location_name ?? '未指定'}</td><td>{binding?<><span className="badge bg-success">{binding.line_display_name||'已綁定'}</span><div className="small text-muted text-truncate" style={{maxWidth:140}}>{binding.line_user_id}</div></>:<span className="text-muted">未綁定</span>}</td><td><span className={`badge bg-${x.is_active?'success':'secondary'}`}>{x.is_active?'啟用':'停用'}</span></td><td><div className="d-flex gap-1 flex-wrap"><button className="btn btn-outline-primary btn-sm" onClick={()=>edit(x)}>編輯</button>{binding?<button className="btn btn-outline-danger btn-sm" disabled={saving} onClick={()=>void lineAction('unbind',x.id)}>解除 LINE</button>:<button className="btn btn-outline-success btn-sm" disabled={saving} onClick={()=>void lineAction('createBindCode',x.id)}>產生綁定碼</button>}{x.is_active&&<button className="btn btn-outline-danger btn-sm" disabled={saving} onClick={()=>void deactivate(x)} title="停用帳號"><i className="bi bi-trash" /> 刪除</button>}</div></td></tr>})}</tbody></table></div></div></div>
  </div>
}
