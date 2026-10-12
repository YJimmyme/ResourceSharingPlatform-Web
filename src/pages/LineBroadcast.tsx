// LINE 被動式物資通報（公布現有物資）。
// 流程：自訂訊息文字 → 以下拉／關鍵字／日期篩選現有物資 → 勾選並核對公布數量
//       → 預覽推播內容 → 推播到所有已綁定 LINE 的使用者。
//
// 說明：實際推播由 Edge Function `line-broadcast` 送出（需 LINE OA 建立並在
// 「LINE 通知設定」填入 Channel Access Token、且使用者完成綁定後才會生效）。
// OA 尚未建立前，可先用「複製訊息」把內容貼到別處使用。
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { functionErrorMessage } from '../lib/functionError'
import { logActivity } from '../lib/activityLog'
import { AllStockTypes, stockTypeDisplayName } from '../lib/enums'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { withinRange } from '../lib/dateRange'
import { itemPhotoUrl } from '../lib/imageUpload'
import type { SupplyItem, SupplyLocation } from '../types/db'

export function LineBroadcast() {
  const [items, setItems] = useState<SupplyItem[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [loading, setLoading] = useState(true)

  const [customText, setCustomText] = useState('提供以下物資，有需要的朋友歡迎與我們聯繫：')
  const [keyword, setKeyword] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [stockTypeFilter, setStockTypeFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // 勾選要公布的物資 id → 公布數量（預設帶現有數量，可核對調整）。
  const [selected, setSelected] = useState<Map<number, number>>(new Map())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [itemRes, locRes] = await Promise.all([
        supabase.from('supply_item').select('*').eq('is_active', true).gt('quantity', 0).order('expiration_date', { ascending: true, nullsFirst: false }),
        supabase.from('supply_location').select('*').eq('is_active', true).order('id'),
      ])
      setItems((itemRes.data ?? []) as SupplyItem[])
      setLocations((locRes.data ?? []) as SupplyLocation[])
      setLoading(false)
    }
    void load()
  }, [])

  const locationName = (id: number) => locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category))).sort(), [items])

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    return items.filter((i) => {
      if (locationFilter && i.location_id !== Number(locationFilter)) return false
      if (categoryFilter && i.category !== categoryFilter) return false
      if (stockTypeFilter && i.stock_type !== stockTypeFilter) return false
      if (!withinRange(i.expiration_date, fromDate, toDate)) return false
      if (k && !`${i.item_name} ${i.category} ${i.specification ?? ''}`.toLowerCase().includes(k)) return false
      return true
    })
  }, [items, keyword, locationFilter, categoryFilter, stockTypeFilter, fromDate, toDate])

  function toggle(item: SupplyItem) {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(item.id)) next.delete(item.id)
      else next.set(item.id, item.quantity)
      return next
    })
  }
  function setPublishQty(id: number, qty: number) {
    setSelected((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.set(id, qty)
      return next
    })
  }
  function selectAllFiltered() {
    setSelected((prev) => {
      const next = new Map(prev)
      for (const i of filtered) if (!next.has(i.id)) next.set(i.id, i.quantity)
      return next
    })
  }
  function clearSelection() {
    setSelected(new Map())
  }

  // 依勾選順序（照篩選後清單）組出要公布的物資列。
  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(i.id)),
    [items, selected]
  )

  const composedMessage = useMemo(() => {
    const lines = selectedItems.map((i) => {
      const qty = selected.get(i.id) ?? i.quantity
      const spec = i.specification?.trim() ? `（${i.specification.trim()}）` : ''
      const exp = i.expiration_date ? `，效期 ${i.expiration_date}` : ''
      return `・${i.item_name}${spec} ${qty} ${i.unit ?? ''}${exp}`
    })
    const head = customText.trim()
    if (lines.length === 0) return head
    return [head, '', ...lines].filter((x) => x !== undefined).join('\n')
  }, [selectedItems, selected, customText])

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(composedMessage)
      setMessage({ ok: true, text: '已複製訊息文字，可貼到其他地方使用。' })
    } catch {
      setMessage({ ok: false, text: '複製失敗，請手動選取訊息內容複製。' })
    }
  }

  async function broadcast() {
    if (selected.size === 0) {
      setMessage({ ok: false, text: '請先勾選要公布的物資。' })
      return
    }
    if (!confirm(`確定推播給所有已綁定 LINE 的使用者？共 ${selected.size} 項物資。`)) return
    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase.functions.invoke('line-broadcast', { body: { message: composedMessage } })
    setBusy(false)
    if (error || !data?.success) {
      setMessage({ ok: false, text: data?.message ?? (await functionErrorMessage(error, '推播失敗（LINE OA 建立並部署 line-broadcast 後即可使用）')) })
      return
    }
    void logActivity({ action: 'line_broadcast', category: '資料維護', targetTable: 'line_bindings', summary: `LINE 物資通報：公布 ${selected.size} 項物資`, detail: { itemCount: selected.size } })
    setMessage({ ok: true, text: data.message ?? '推播完成。' })
  }

  return (
    <div className="container-fluid mt-4">
      <h2 className="mb-3">
        <i className="bi bi-megaphone" /> LINE 物資通報
      </h2>
      <div className="alert alert-light border small">
        <i className="bi bi-info-circle" /> 自訂訊息＋勾選要公布的物資後即可推播到已綁定 LINE 的使用者。
        推播需「LINE 通知設定」已填入 Token 且使用者完成綁定；OA 尚未建立前可先用「複製訊息」。
      </div>

      {message && <div className={`alert ${message.ok ? 'alert-success' : 'alert-danger'}`}>{message.text}</div>}

      <div className="row">
        {/* 左：訊息 + 篩選 + 物資勾選 */}
        <div className="col-lg-7">
          <div className="card shadow-sm mb-3">
            <div className="card-header bg-light"><i className="bi bi-pencil-square" /> 訊息文字</div>
            <div className="card-body">
              <textarea className="form-control" rows={3} value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="輸入要公布的文字說明" />
            </div>
          </div>

          <div className="card shadow-sm mb-3">
            <div className="card-header bg-light"><i className="bi bi-funnel" /> 篩選要公布的物資</div>
            <div className="card-body">
              <div className="row g-3">
                <div className="col-md-4">
                  <label className="form-label">關鍵字</label>
                  <input className="form-control" placeholder="名稱、種類、規格" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">據點</label>
                  <select className="form-select" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                    <option value="">全部據點</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.location_name}</option>)}
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label">種類</label>
                  <select className="form-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                    <option value="">全部種類</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label">庫存分類</label>
                  <select className="form-select" value={stockTypeFilter} onChange={(e) => setStockTypeFilter(e.target.value)}>
                    <option value="">全部分類</option>
                    {AllStockTypes.map((st) => <option key={st} value={st}>{stockTypeDisplayName(st)}</option>)}
                  </select>
                </div>
                <div className="col-md-8">
                  <label className="form-label">有效期限區間</label>
                  <DateRangeFilter from={fromDate} to={toDate} onFrom={setFromDate} onTo={setToDate} />
                </div>
              </div>
              <div className="d-flex gap-2 mt-3">
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={selectAllFiltered} disabled={filtered.length === 0}>
                  <i className="bi bi-check2-all" /> 全選目前篩選（{filtered.length}）
                </button>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clearSelection} disabled={selected.size === 0}>
                  <i className="bi bi-x-circle" /> 清除選取
                </button>
              </div>
            </div>
          </div>

        </div>

        {/* 右：預覽 + 推播 */}
        <div className="col-lg-5">
          <div className="card shadow-sm" style={{ position: 'sticky', top: 16 }}>
            <div className="card-header bg-light"><i className="bi bi-eye" /> 推播內容預覽</div>
            <div className="card-body">
              <pre className="border rounded bg-light p-3 mb-3" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: 220 }}>{composedMessage || '（尚未輸入訊息或選取物資）'}</pre>
              <div className="d-flex gap-2">
                <button type="button" className="btn btn-outline-secondary" onClick={() => void copyMessage()}>
                  <i className="bi bi-clipboard" /> 複製訊息
                </button>
                <button type="button" className="btn btn-primary flex-grow-1" onClick={() => void broadcast()} disabled={busy || selected.size === 0}>
                  <i className="bi bi-send" /> {busy ? '推播中…' : `推播（${selected.size} 項）`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 物資清單（整頁寬，填滿畫面） */}
      <div className="card shadow-sm mt-3">
        <div className="card-header bg-light d-flex justify-content-between align-items-center">
          <span><i className="bi bi-list-check" /> 物資清單</span>
          <span className="text-muted small">已選 {selected.size} 項</span>
        </div>
        <div className="table-responsive" style={{ maxHeight: 640, overflowY: 'auto' }}>
          <table className="table table-hover align-middle mb-0" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '4%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '9%' }} />
            </colgroup>
            <thead className="table-light">
              <tr>
                <th />
                <th>照片</th>
                <th>種類</th>
                <th>名稱</th>
                <th>規格</th>
                <th className="text-nowrap">現有</th>
                <th className="text-nowrap">公布數量</th>
                <th className="text-nowrap">效期</th>
                <th>據點</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center text-muted py-4">載入中…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center text-muted py-4">沒有符合條件的物資</td></tr>
              ) : (
                filtered.map((i) => {
                  const checked = selected.has(i.id)
                  const url = itemPhotoUrl(i.image_path)
                  return (
                    <tr key={i.id} className={checked ? 'table-primary' : ''}>
                      <td><input type="checkbox" className="form-check-input" checked={checked} onChange={() => toggle(i)} /></td>
                      <td>
                        {url ? (
                          <img src={url} alt={i.item_name} style={{ width: 48, height: 48, objectFit: 'cover' }} className="rounded border" />
                        ) : (
                          <i className="bi bi-image text-muted fs-3" />
                        )}
                      </td>
                      <td style={{ wordBreak: 'break-word' }}>{i.category}</td>
                      <td style={{ wordBreak: 'break-word' }}><strong>{i.item_name}</strong></td>
                      <td style={{ wordBreak: 'break-word' }}>{i.specification?.trim() || '無'}</td>
                      <td className="text-nowrap">{i.quantity} {i.unit ?? ''}</td>
                      <td>
                        <input type="number" className="form-control form-control-sm" min={1} max={i.quantity} disabled={!checked}
                          value={checked ? (selected.get(i.id) ?? i.quantity) : ''}
                          onChange={(e) => setPublishQty(i.id, Math.max(1, Math.min(i.quantity, Number(e.target.value) || 1)))} />
                      </td>
                      <td className="text-nowrap">{i.expiration_date ?? '—'}</td>
                      <td style={{ wordBreak: 'break-word' }}>{locationName(i.location_id)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
