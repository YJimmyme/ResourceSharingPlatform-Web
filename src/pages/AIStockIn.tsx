import { visionBase, visionRequest, type VisionFeedback } from '../lib/visionApi'
import { VisionFeedbackEditor } from '../components/VisionFeedbackEditor'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { AllStockTypes, Roles, stockTypeDisplayName } from '../lib/enums'
import { supabase } from '../lib/supabaseClient'
import { functionErrorMessage } from '../lib/functionError'
import { attachSharedAiPhoto } from '../lib/imageUpload'
import { logActivity } from '../lib/activityLog'
import { DateSelect } from '../components/DateSelect'
import { FlashMessage } from '../components/FlashMessage'
import type { AIStockInLog, SupplyLocation, InventoryItemDefinition, InventoryItemVariant } from '../types/db'

// 每一筆辨識結果（可編輯）；logId 對應各自的 ai_stock_in_log 列。
type AiItem = {
  logId: number
  category: string
  itemName: string
  specification: string
  quantity: number | string
  unit: string
  stockType: string
  expirationDate: string
  safetyStock: number | string
  remark: string
  confidence: number | null
}

function toItem(x: AIStockInLog): AiItem {
  return {
    logId: x.id,
    category: x.suggested_category ?? '',
    itemName: x.suggested_item_name ?? '',
    specification: x.suggested_specification ?? '',
    quantity: x.suggested_quantity ?? '',
    unit: x.suggested_unit ?? '個',
    stockType: x.suggested_stock_type ?? 'HasExpiry',
    expirationDate: x.suggested_expiration_date ?? '',
    safetyStock: x.suggested_safety_stock ?? 0,
    remark: x.suggested_remark ?? '',
    confidence: x.confidence == null ? null : Number(x.confidence),
  }
}

// 手動新增品項（AI 辨識失敗/漏判時人工輸入）；logId 給唯一負數當標記，
// confirmAll 時 logId<=0 走「直接寫入庫存」而非 ai-stockin-confirm。
let manualSeq = -1
function blankManualItem(): AiItem {
  return { logId: manualSeq--, category: '', itemName: '', specification: '', quantity: 1, unit: '個', stockType: 'HasExpiry', expirationDate: '', safetyStock: 0, remark: '', confidence: null }
}

export function AIStockInCreate() {
  const { profile } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const isAdmin = profile?.role_name === Roles.Admin

  const [locations, setLocations] = useState<SupplyLocation[]>([])
  // 庫存種類目錄：核對畫面的 種類／名稱／規格／單位 改用下拉選單（與物資入庫一致）。
  const [definitions, setDefinitions] = useState<InventoryItemDefinition[]>([])
  const [variants, setVariants] = useState<InventoryItemVariant[]>([])
  const [locationId, setLocationId] = useState<number | null>(profile?.location_id ?? null)
  const [inputText, setInputText] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [items, setItems] = useState<AiItem[] | null>(null) // null = 尚未辨識（顯示輸入畫面）
  const [imageUrl, setImageUrl] = useState<string | null>(null) // 給使用者核對的照片預覽
  const [imagePath, setImagePath] = useState<string | null>(null) // ai-stockin bucket 路徑（搬移照片用）
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<VisionFeedback | null>(null)
  const [complexity, setComplexity] = useState('simple')
  const [forceReview, setForceReview] = useState(false)

  useEffect(() => {
    supabase.from('supply_location').select('*').eq('is_active', true).order('id').then(({ data }) => setLocations((data ?? []) as SupplyLocation[]))
    supabase.from('inventory_item_definition').select('*').eq('is_active', true).then(({ data }) => setDefinitions((data ?? []) as InventoryItemDefinition[]))
    supabase.from('inventory_item_variant').select('*').eq('is_active', true).then(({ data }) => setVariants((data ?? []) as InventoryItemVariant[]))
    const id = params.get('id')
    if (id) {
      // 從紀錄頁「前往確認」進來：載入單一待確認項目。
      supabase.from('ai_stock_in_log').select('*').eq('id', Number(id)).single().then(async ({ data }) => {
        if (!data) return
        const log = data as AIStockInLog
        setLocationId(log.location_id)
        setItems([toItem(log)])
        if (log.input_image_path) {
          setImagePath(log.input_image_path)
          const { data: signed } = await supabase.storage.from('ai-stockin').createSignedUrl(log.input_image_path, 600)
          if (signed?.signedUrl) setImageUrl(signed.signedUrl)
        }
      })
    }
  }, [params])

  function updateItem(logId: number, patch: Partial<AiItem>) {
    setItems((prev) => (prev ? prev.map((it) => (it.logId === logId ? { ...it, ...patch } : it)) : prev))
  }
  function removeItem(logId: number) {
    setItems((prev) => (prev && prev.length > 1 ? prev.filter((it) => it.logId !== logId) : prev))
  }
  function addManualItem() {
    setItems((prev) => [...(prev ?? []), blankManualItem()])
    setMessage(null)
  }

  async function recognize(e: FormEvent) {
    e.preventDefault()
    if (!locationId) { setMessage({ ok: false, text: '請選擇據點' }); return }
    setBusy(true)
    setMessage(null)
    let uploadedPath: string | undefined
    if (image) {
      if (!image.type.startsWith('image/') || image.size > 10 * 1024 * 1024) {
        setMessage({ ok: false, text: '僅支援 10MB 以下圖片' }); setBusy(false); return
      }
      const ext = image.name.split('.').pop()?.toLowerCase() || 'jpg'
      uploadedPath = `${profile?.id}/${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage.from('ai-stockin').upload(uploadedPath, image)
      if (error) { setMessage({ ok: false, text: error.message }); setBusy(false); return }
    }
    type RecognitionData = { success: boolean; message: string; logs?: AIStockInLog[]; log?: AIStockInLog; feedback?: VisionFeedback }
    const body = { locationId, inputText, imagePath: uploadedPath, complexity, forceReview }
    const { data, error } = visionBase && uploadedPath
      ? await visionRequest<RecognitionData>('/recognize', body).then(data => ({ data, error: null })).catch((error: Error) => ({ data: null, error }))
      : await supabase.functions.invoke<RecognitionData>('ai-stockin-recognize', { body })
    setFeedback(data?.feedback ?? null)
    setBusy(false)
    if (error || !data?.success) {
      setMessage({ ok: false, text: data?.message ?? (error instanceof Error ? error.message : await functionErrorMessage(error, '辨識失敗')) })
      return
    }
    // 後端已支援多品項：回傳 logs[]（每項一列 ai_stock_in_log），舊版只回 log。
    const logs: AIStockInLog[] = Array.isArray(data.logs) && data.logs.length ? data.logs : data.log ? [data.log] : []
    setItems(logs.map(toItem))
    setImagePath(uploadedPath ?? null)
    setImageUrl(image ? URL.createObjectURL(image) : null)
    setMessage({ ok: true, text: data.message })
  }

  async function confirmAll(e: FormEvent) {
    e.preventDefault()
    if (!items || !items.length) return
    if (!locationId) { setMessage({ ok: false, text: '請選擇據點' }); return }
    // 送出前基本驗證（含手動品項）。
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (visionBase && imagePath && !definitions.some(d => d.stock_type === it.stockType && d.category === it.category && d.item_name === it.itemName)) { setMessage({ ok: false, text: `品項 ${i + 1}：請選擇目錄中的標準品項，或由管理員先新增目錄` }); return }
      if (!it.category.trim() || !it.itemName.trim()) { setMessage({ ok: false, text: `品項 ${i + 1}：請填物資種類與名稱` }); return }
      if (!it.quantity || Number(it.quantity) <= 0) { setMessage({ ok: false, text: `品項 ${i + 1}：數量需大於 0` }); return }
      if (it.stockType !== 'NoExpiry' && !it.expirationDate) { setMessage({ ok: false, text: `品項 ${i + 1}：有效期物資／冷凍食品需填有效期限` }); return }
    }
    setBusy(true)
    setMessage(null)
    const operator = profile?.display_name ?? profile?.username ?? null

    const confirmed: { id: number; quantity: number }[] = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (visionBase && imagePath && !definitions.some(d => d.stock_type === it.stockType && d.category === it.category && d.item_name === it.itemName)) { setMessage({ ok: false, text: `品項 ${i + 1}：請選擇目錄中的標準品項，或由管理員先新增目錄` }); return }
      if (it.logId > 0) {
        // AI 辨識項目：走 ai-stockin-confirm（會標記該筆 log 已確認並建立庫存）
        const { data, error } = await supabase.functions.invoke('ai-stockin-confirm', {
          body: {
            logId: it.logId, locationId,
            category: it.category, itemName: it.itemName, specification: it.specification,
            quantity: it.quantity, unit: it.unit, stockType: it.stockType,
            expirationDate: it.stockType === 'NoExpiry' ? '' : it.expirationDate,
            safetyStock: it.safetyStock, remark: it.remark,
          },
        })
        if (error || !data?.success) {
          setBusy(false)
          setMessage({ ok: false, text: `品項 ${i + 1}「${it.itemName}」入庫失敗：${data?.message ?? await functionErrorMessage(error, '確認失敗')}（前 ${confirmed.length} 項已入庫）` })
          return
        }
        if (data.item?.id) {
          confirmed.push({ id: data.item.id, quantity: data.item.quantity })
          await supabase.from('supply_stock_in_log').insert({
            supply_item_id: data.item.id, location_id: locationId,
            stock_in_quantity: Number(it.quantity), operator, remark: 'AI 智慧入庫',
          })
        }
      } else {
        // 手動新增品項：直接寫入庫存（RLS 依角色/據點），不經 ai-stockin-confirm
        const res = await supabase.from('supply_item').insert({
          category: it.category.trim(), item_name: it.itemName.trim(),
          specification: it.specification.trim() || null, unit: it.unit.trim() || '個',
          stock_type: it.stockType, quantity: Number(it.quantity),
          expiration_date: it.stockType === 'NoExpiry' ? null : it.expirationDate,
          location_id: locationId, safety_stock: Number(it.safetyStock) || 0,
          remark: it.remark.trim() || null, created_by: operator,
        }).select('id').single()
        if (res.error || !res.data) {
          setBusy(false)
          setMessage({ ok: false, text: `品項 ${i + 1}「${it.itemName}」手動入庫失敗：${res.error?.message ?? '寫入失敗'}（前 ${confirmed.length} 項已入庫）` })
          return
        }
        confirmed.push({ id: res.data.id, quantity: Number(it.quantity) })
        await supabase.from('supply_stock_in_log').insert({
          supply_item_id: res.data.id, location_id: locationId,
          stock_in_quantity: Number(it.quantity), operator, remark: '手動新增（AI 入庫頁）',
        })
      }
    }

    // 一張照片可能對應多筆品項：把同一張照片複製給每一筆，最後才刪除來源。
    await attachSharedAiPhoto(imagePath, confirmed)

    void logActivity({ action: 'ai_stock_in', category: '庫存異動', targetTable: 'supply_item', locationId: locationId ?? null, summary: `AI 智慧入庫確認，共 ${confirmed.length} 項`, detail: { items: items.map((it) => ({ name: it.itemName, quantity: Number(it.quantity) })) } })
    setBusy(false)
    navigate('/', { state: { flash: `AI 智慧入庫完成，共 ${confirmed.length} 項` } })
  }

  const locationName = locations.find((x) => x.id === locationId)?.location_name ?? ''

  // 依庫存分類（stockType）推導「物資種類」選項；再依種類推名稱、依名稱推規格與單位。
  const categoriesByType = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const st of AllStockTypes) {
      map[st] = Array.from(new Set(definitions.filter((d) => d.stock_type === st).map((d) => d.category))).sort()
    }
    return map
  }, [definitions])
  function itemNamesFor(stockType: string, category: string): string[] {
    return Array.from(new Set(definitions.filter((d) => d.stock_type === stockType && d.category === category).map((d) => d.item_name))).sort()
  }
  function defForItem(it: AiItem): InventoryItemDefinition | null {
    return definitions.find((d) => d.stock_type === it.stockType && d.category === it.category && d.item_name === it.itemName) ?? null
  }
  function specsForItem(it: AiItem): InventoryItemVariant[] {
    const def = defForItem(it)
    return def ? variants.filter((v) => v.inventory_item_definition_id === def.id && v.specification) : []
  }

  return (
    <div className="container mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2><i className="bi bi-stars" /> AI 智慧入庫</h2>
        <div className="d-flex gap-2">
          <button type="button" className="btn btn-outline-secondary" onClick={() => navigate(-1)}><i className="bi bi-arrow-left" /> 返回上一頁</button>
          <Link className="btn btn-outline-secondary" to="/ai-stockin"><i className="bi bi-list-ul" /> 辨識紀錄</Link>
        </div>
      </div>

      {/* 辨識中狀態 */}
      {busy && !items && (
        <div className="alert alert-info d-flex align-items-center">
          <span className="spinner-border spinner-border-sm me-2" role="status" /> AI 辨識中，請稍候…
        </div>
      )}

      {feedback && <VisionFeedbackEditor key={feedback.id} result={feedback} names={definitions.map(d => d.item_name)} />}
      {visionBase && <div className="alert alert-info">照片辨識：YOLO 優先，不確定時由 OpenAI 複核。<label className="ms-3">物件難度 <select value={complexity} onChange={e => setComplexity(e.target.value)}><option value="simple">簡易物件</option><option value="complex">複雜物件</option></select></label><label className="ms-3"><input type="checkbox" checked={forceReview} onChange={e => setForceReview(e.target.checked)} /> 本次一定交由 OpenAI 複核</label></div>}
      {message && (
        <div className={`alert alert-${message.ok ? 'success' : 'danger'}`}>
          <div>{message.ok ? '' : '辨識失敗：'}{message.text}</div>
          {!message.ok && (
            <div className="mt-2 d-flex gap-2 flex-wrap">
              <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setMessage(null)}>
                <i className="bi bi-pencil" /> 重新輸入再試
              </button>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => window.location.reload()}>
                <i className="bi bi-arrow-clockwise" /> 重新整理
              </button>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => navigate(-1)}>
                <i className="bi bi-arrow-left" /> 返回上一頁
              </button>
            </div>
          )}
        </div>
      )}

      {!items ? (
        // ── 步驟一：辨識來源 ─────────────────────────────
        <form onSubmit={recognize}>
          <div className="card shadow-sm mb-4"><div className="card-header bg-light"><i className="bi bi-geo-alt" /> 步驟一：所在據點</div><div className="card-body">
            <label className="form-label">據點 *</label>
            {isAdmin
              ? <select className="form-select" required value={locationId ?? ''} onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">請選擇據點</option>
                  {locations.map((x) => <option key={x.id} value={x.id}>{x.location_name}</option>)}
                </select>
              : <input className="form-control" disabled value={locationName} />}
            {!isAdmin && <div className="form-text">已預設為你的所屬據點；僅管理員可切換。</div>}
          </div></div>

          <div className="card shadow-sm mb-4"><div className="card-header bg-light"><i className="bi bi-camera" /> 步驟二：辨識來源（文字或照片）</div><div className="card-body">
            <div className="mb-3">
              <label className="form-label">文字描述</label>
              <textarea className="form-control" rows={3} placeholder="例如：白米 10 包，每包 2 公斤，2027-01-01 到期；礦泉水 2 箱" value={inputText} onChange={(e) => setInputText(e.target.value)} />
              <div className="form-text">可一次描述多項物資；系統會逐項辨識。</div>
            </div>
            <div className="mb-3">
              <label className="form-label">或上傳照片</label>
              <input className="form-control" type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] ?? null; setImage(f); setImageUrl(f ? URL.createObjectURL(f) : null) }} />
              <div className="form-text">一張照片若有多項物資，會自動拆成多筆逐項核對。</div>
            </div>
            {imageUrl && (
              <div className="text-center">
                <img src={imageUrl} alt="待辨識照片" style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain' }} className="border rounded" />
              </div>
            )}
          </div></div>

          <div className="d-flex justify-content-between gap-2 flex-wrap">
            <button type="button" className="btn btn-outline-primary btn-lg" disabled={busy} onClick={addManualItem}>
              <i className="bi bi-pencil-square" /> 改用手動輸入
            </button>
            <button className="btn btn-primary btn-lg" disabled={busy || (!inputText.trim() && !image)}>
              {busy ? '辨識中…' : '開始辨識'}
            </button>
          </div>
        </form>
      ) : (
        // ── 步驟三：人工核對（可多品項）───────────────────
        <form onSubmit={confirmAll}>
          <div className="row">
            <div className="col-lg-8">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h5 className="mb-0"><i className="bi bi-check2-square" /> 人工核對辨識結果</h5>
                <span className="text-muted small">共 {items.length} 筆品項（入庫據點：{locationName}）</span>
              </div>

              {items.map((it, idx) => (
                <div key={it.logId} className="card shadow-sm mb-3">
                  <div className="card-header bg-light d-flex justify-content-between align-items-center">
                    <span>
                      <i className="bi bi-box" /> 品項 {idx + 1}
                      {it.logId <= 0 && <span className="badge ms-2 bg-info text-dark">手動</span>}
                      {it.confidence != null && <span className={`badge ms-2 bg-${it.confidence >= 0.7 ? 'success' : it.confidence >= 0.5 ? 'warning text-dark' : 'secondary'}`}>信心 {Math.round(it.confidence * 100)}%</span>}
                    </span>
                    {items.length > 1 && (
                      <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removeItem(it.logId)}>
                        <i className="bi bi-trash" /> 不入庫此項
                      </button>
                    )}
                  </div>
                  <div className="card-body">
                    <div className="row g-3">
                      <div className="col-md-6">
                        <label className="form-label">物資種類 *</label>
                        <select className="form-select" required value={it.category} onChange={(e) => updateItem(it.logId, { category: e.target.value, itemName: '', specification: '', unit: '' })}>
                          <option value="">請選擇物資種類</option>
                          {it.category && !(categoriesByType[it.stockType] ?? []).includes(it.category) && <option value={it.category}>{it.category}（請重新選擇目錄種類）</option>}
                          {(categoriesByType[it.stockType] ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">物資名稱 *</label>
                        <select className="form-select" required disabled={!it.category} value={it.itemName} onChange={(e) => { const name = e.target.value; const d = definitions.find((x) => x.stock_type === it.stockType && x.category === it.category && x.item_name === name); updateItem(it.logId, { itemName: name, specification: '', unit: d?.unit ?? '' }) }}>
                          <option value="">{it.category ? '請選擇物資名稱' : '請先選擇物資種類'}</option>
                          {it.itemName && !itemNamesFor(it.stockType, it.category).includes(it.itemName) && <option value={it.itemName}>{it.itemName}（未在目錄，請修正）</option>}
                          {itemNamesFor(it.stockType, it.category).map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">規格</label>
                        <select className="form-select" disabled={!it.itemName} value={it.specification} onChange={(e) => updateItem(it.logId, { specification: e.target.value })}>
                          <option value="">{it.itemName ? '無（未指定，可稍後由總管補規格）' : '請先選擇物資名稱'}</option>
                          {specsForItem(it).map((v) => <option key={v.id} value={v.specification ?? ''}>{v.specification}</option>)}
                        </select>
                      </div>
                      <ItemField label="數量" type="number" value={it.quantity} onChange={(v) => updateItem(it.logId, { quantity: v })} />
                      <div className="col-md-6">
                        <label className="form-label">單位 *</label>
                        <input className="form-control" disabled value={it.unit || defForItem(it)?.unit || ''} />
                        <div className="form-text">依所選物資名稱自動帶入。</div>
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">庫存分類</label>
                        <select className="form-select" value={it.stockType} onChange={(e) => updateItem(it.logId, { stockType: e.target.value, category: '', itemName: '', specification: '', unit: '' })}>
                          {AllStockTypes.map((x) => <option key={x} value={x}>{stockTypeDisplayName(x)}</option>)}
                        </select>
                      </div>
                      {it.stockType !== 'NoExpiry' && (
                        <div className="col-md-6">
                          <label className="form-label">有效期限 *</label>
                          <DateSelect value={it.expirationDate} onChange={(v) => updateItem(it.logId, { expirationDate: v })} />
                        </div>
                      )}
                      <ItemField label="安全庫存" required={false} type="number" value={it.safetyStock} onChange={(v) => updateItem(it.logId, { safetyStock: v })} />
                      <div className="col-12">
                        <label className="form-label">備註</label>
                        <textarea className="form-control" rows={1} value={it.remark} onChange={(e) => updateItem(it.logId, { remark: e.target.value })} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              <div className="d-flex justify-content-between gap-2 flex-wrap">
                <button type="button" className="btn btn-outline-primary" disabled={busy} onClick={addManualItem}>
                  <i className="bi bi-plus-circle" /> 新增品項（手動）
                </button>
                <div className="d-flex gap-2">
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setItems(null); setMessage(null) }}>重新辨識</button>
                  <button className="btn btn-success" disabled={busy}>{busy ? '入庫中…' : `確認並正式入庫（${items.length} 項）`}</button>
                </div>
              </div>
            </div>

            <div className="col-lg-4">
              {imageUrl && (
                <div className="card shadow-sm mb-3">
                  <div className="card-header bg-light"><i className="bi bi-image" /> 辨識照片</div>
                  <div className="card-body text-center">
                    <img src={imageUrl} alt="辨識照片" style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain' }} className="rounded" />
                    <div className="form-text mt-2">請對照照片核對上面每一筆品項。</div>
                  </div>
                </div>
              )}
              <div className="alert alert-warning">請務必核對每一筆的品項、數量、效期。只有按下「確認並正式入庫」後才會寫入正式庫存。</div>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}

function ItemField({ label, value, onChange, type = 'text', required = true }: { label: string; value: string | number; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <div className="col-md-6">
      <label className="form-label">{label}{required ? ' *' : ''}</label>
      <input className="form-control" required={required} type={type} min={type === 'number' ? 0 : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

export function AIStockInIndex(){const[logs,setLogs]=useState<AIStockInLog[]>([]),[locations,setLocations]=useState<SupplyLocation[]>([]),[keyword,setKeyword]=useState(''),[locationFilter,setLocationFilter]=useState(''),[statusFilter,setStatusFilter]=useState<''|'confirmed'|'pending'>('');useEffect(()=>{Promise.all([supabase.from('ai_stock_in_log').select('*').order('created_at',{ascending:false}).limit(100),supabase.from('supply_location').select('*')]).then(([a,b])=>{setLogs((a.data??[])as AIStockInLog[]);setLocations((b.data??[])as SupplyLocation[])})},[]);const rows=useMemo(()=>{const k=keyword.toLowerCase();return logs.filter(x=>(!locationFilter||x.location_id===Number(locationFilter))&&(!statusFilter||(statusFilter==='confirmed'?x.is_confirmed:!x.is_confirmed))&&`${x.suggested_item_name??''} ${x.input_text??''} ${x.operator??''}`.toLowerCase().includes(k))},[logs,keyword,locationFilter,statusFilter]);function resetFilters(){setKeyword('');setLocationFilter('');setStatusFilter('')}return <div className="container-fluid mt-4"><div className="d-flex justify-content-between"><h2><i className="bi bi-stars"/> AI 智慧入庫紀錄</h2><Link className="btn btn-primary" to="/ai-stockin/create">新增辨識</Link></div><FlashMessage/><div className="card my-3"><div className="card-header bg-light"><i className="bi bi-funnel" /> 篩選條件</div><div className="card-body"><div className="row g-3">
  <div className="col-md-5"><label className="form-label">關鍵字</label><input className="form-control" placeholder="搜尋物資、描述或操作人員" value={keyword} onChange={(e)=>setKeyword(e.target.value)}/></div>
  <div className="col-md-3"><label className="form-label">據點</label><select className="form-select" value={locationFilter} onChange={(e)=>setLocationFilter(e.target.value)}><option value="">全部據點</option>{locations.map(l=><option key={l.id} value={l.id}>{l.location_name}</option>)}</select></div>
  <div className="col-md-3"><label className="form-label">狀態</label><select className="form-select" value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value as ''|'confirmed'|'pending')}><option value="">全部</option><option value="confirmed">已確認</option><option value="pending">待確認</option></select></div>
  <div className="col-md-1 d-flex align-items-end"><button type="button" className="btn btn-secondary w-100" onClick={resetFilters} title="重設"><i className="bi bi-arrow-clockwise" /></button></div>
</div></div></div><div className="card"><div className="table-responsive"><table className="table table-hover mb-0"><thead><tr><th>時間</th><th>據點</th><th>輸入</th><th>建議品項</th><th>信心</th><th>狀態</th><th>操作人員</th></tr></thead><tbody>{rows.map(x=><tr key={x.id}><td>{new Date(x.created_at).toLocaleDateString('zh-TW')}</td><td>{locations.find(l=>l.id===x.location_id)?.location_name}</td><td>{x.input_type==='Image'?'照片':x.input_text}</td><td>{x.suggested_item_name}</td><td>{x.confidence==null?'-':`${Math.round(Number(x.confidence)*100)}%`}</td><td><span className={`badge bg-${x.is_confirmed?'success':'secondary'}`}>{x.is_confirmed?'已確認':'待確認'}</span></td><td>{x.operator}</td></tr>)}</tbody></table></div></div></div>}
