// 物資總覽色塊點擊後跳來的「狀態清單」頁（分工單 p.2 跳頁 + p.4 共用版面 + p.5/6/7 舉手）。
// 舉手邏輯（依需求修正）：需求方＝「我的據點」（自動、不用選），要選的是「哪個據點有貨」——
// 來源下拉只列出實際有此品項庫存的其他據點並顯示現有數量。來源據點之後透過物資轉移補貨。
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { locationColorStyle } from '../lib/colors'
import { statusColorMap, type DashboardStatusKey } from '../lib/statusColors'
import { fetchLowStock, isItemLowStock, emptyLowStock, type LowStockData } from '../lib/lowStock'
import { itemPhotoUrl } from '../lib/imageUpload'
import { stockTypeDisplayName, stockTypeBadgeClass, Roles } from '../lib/enums'
import { logActivity } from '../lib/activityLog'
import { EXPIRY_WARNING_DAYS } from '../lib/stockBatch'
import { FlashMessage } from '../components/FlashMessage'
import { RaiseRequestModal } from '../components/RaiseRequestModal'
import type { SupplyItem, SupplyLocation } from '../types/db'

interface Row {
  key: string
  id: number | null // supply_item 流水號；總量不足為 null
  image_path: string | null
  category: string
  item_name: string
  specification: string | null
  stock_type: string | null
  unit: string | null
  locationId: number | null // null = 全系統（總量不足）
  quantity: number | null
  expiration: string | null
  note: string | null // 門檻等附註（總量不足用）
}

interface GlobalLowRow {
  category: string
  item_name: string
  specification: string | null
  unit: string
  global_safety_stock: number
  global_threshold: number
  total_quantity: number
}

function isValidStatus(s: string | undefined): s is DashboardStatusKey {
  return s === 'locationLowStock' || s === 'globalLowStock' || s === 'expiringSoon' || s === 'expired'
}

export function StatusList() {
  const { status } = useParams<{ status: string }>()
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [items, setItems] = useState<SupplyItem[]>([])
  const [globalLow, setGlobalLow] = useState<GlobalLowRow[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [lowStock, setLowStock] = useState<LowStockData>(emptyLowStock)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(true)

  // 舉手彈窗（表單邏輯已抽到 components/RaiseRequestModal）
  const [raiseRow, setRaiseRow] = useState<Row | null>(null)
  // 申請報廢彈窗（填原因）
  const [disposalRow, setDisposalRow] = useState<Row | null>(null)
  const [disposalReason, setDisposalReason] = useState('已過期')
  const [disposalSaving, setDisposalSaving] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [itemsRes, locRes, globalRes, low] = await Promise.all([
        supabase.from('supply_item').select('*').eq('is_active', true).order('expiration_date', { ascending: true, nullsFirst: false }),
        supabase.from('supply_location').select('*').eq('is_active', true).order('id'),
        supabase.from('global_low_stock_view').select('category, item_name, specification, unit, global_safety_stock, global_threshold, total_quantity'),
        fetchLowStock(),
      ])
      setItems((itemsRes.data ?? []) as SupplyItem[])
      setLocations((locRes.data ?? []) as SupplyLocation[])
      setGlobalLow((globalRes.data ?? []) as GlobalLowRow[])
      setLowStock(low)
      setLoading(false)
    }
    void load()
  }, [])

  function locationName(id: number | null): string {
    if (id == null) return '（全系統）'
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  const today = new Date().toISOString().slice(0, 10)
  const in30 = new Date(Date.now() + EXPIRY_WARNING_DAYS * 86400000).toISOString().slice(0, 10)

  const rows = useMemo<Row[]>(() => {
    if (!isValidStatus(status)) return []
    if (status === 'globalLowStock') {
      return globalLow.map((g) => ({
        key: `g-${g.category}-${g.item_name}-${g.specification ?? ''}`,
        id: null,
        image_path: null,
        category: g.category,
        item_name: g.item_name,
        specification: g.specification,
        stock_type: null,
        unit: g.unit,
        locationId: null,
        quantity: g.total_quantity,
        expiration: null,
        note: `募資觸發點 ${Math.max(0, g.global_threshold - g.global_safety_stock)} ${g.unit}（門檻 ${g.global_threshold} − 安全 ${g.global_safety_stock}，請啟動募資）`,
      }))
    }
    // 已過期：幫主/小幫手只看自己據點的（總管不限）。
    const expiredOwnOnly = profile?.role_name !== Roles.Admin
    const myLoc = profile?.location_id ?? null
    // 小幫手：所有狀態清單一律只看自己據點。
    const isSocialWorker = profile?.role_name === Roles.SocialWorker
    const picked = items.filter((it) => {
      if (isSocialWorker && it.location_id !== myLoc) return false
      if (status === 'locationLowStock') return isItemLowStock(it, lowStock)
      if (status === 'expiringSoon') return it.expiration_date != null && it.expiration_date >= today && it.expiration_date <= in30
      if (status === 'expired') {
        if (it.expiration_date == null || it.expiration_date >= today) return false
        if (expiredOwnOnly && it.location_id !== myLoc) return false
        return true
      }
      return false
    })
    return picked.map((it) => ({
      key: `i-${it.id}`,
      id: it.id,
      image_path: it.image_path,
      category: it.category,
      item_name: it.item_name,
      specification: it.specification,
      stock_type: it.stock_type,
      unit: it.unit,
      locationId: it.location_id,
      quantity: it.quantity,
      expiration: it.expiration_date,
      note: null,
    }))
  }, [status, items, globalLow, lowStock, today, in30, profile])

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    if (!k) return rows
    return rows.filter((r) => `${r.category} ${r.item_name} ${r.specification ?? ''}`.toLowerCase().includes(k))
  }, [rows, keyword])

  const isAdmin = profile?.role_name === Roles.Admin
  const isCadre = profile?.role_name === Roles.Cadre
  // 舉手／申請報廢是「送需求給總管審核」的請求功能（非直接動別據點庫存），
  // 依權限設計：總管與幫主可用，小幫手無。看得到全部據點，但直接操作（如物資
  // 明細「調整」）另在各頁鎖自己據點。
  const isAdminOrCadre = isAdmin || isCadre

  // 幫主對已過期的「向總管申請報廢」：沿用舉手（supply_request），type=disposal，指定批次。
  // 原因改用彈窗填寫（與其他操作一致），總管在「待處理需求 → 詳細」會看到。
  async function submitDisposalRequest() {
    const row = disposalRow
    if (!row || row.id == null || row.locationId == null) return
    setDisposalSaving(true)
    const note = disposalReason.trim() || '已過期，申請報廢'
    const { error: insErr } = await supabase.from('supply_request').insert({
      request_type: 'disposal',
      supply_item_id: row.id,
      category: row.category,
      item_name: row.item_name,
      specification: row.specification,
      requesting_location_id: row.locationId,
      quantity: row.quantity ?? 0,
      requested_by: profile?.display_name ?? profile?.username ?? null,
      note,
      status: 'Open',
    })
    setDisposalSaving(false)
    if (insErr) {
      alert(insErr.message)
      return
    }
    void logActivity({ action: 'request_disposal', category: '申請', targetTable: 'supply_request', targetId: row.id, locationId: row.locationId, summary: `申請報廢「${row.item_name}」${row.quantity ?? ''} ${row.unit ?? ''}（已過期）` })
    setDisposalRow(null)
    navigate('/', { state: { flash: `已向總管申請報廢：${row.item_name}` } })
  }

  if (!isValidStatus(status)) {
    return (
      <div className="container-fluid mt-4">
        <div className="alert alert-warning">未知的狀態頁面。</div>
        <Link className="btn btn-secondary" to="/">
          返回物資總覽
        </Link>
      </div>
    )
  }

  const c = statusColorMap[status]

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="mb-0">
          <span className="badge me-2" style={{ backgroundColor: c.bg, color: c.text }}>
            <i className={`bi ${c.icon}`} />
          </span>
          {c.label}
        </h2>
        <Link className="btn btn-outline-secondary" to="/">
          <i className="bi bi-arrow-left" /> 返回物資總覽
        </Link>
      </div>
      <FlashMessage />

      <div className="card shadow-sm mb-3">
        <div className="card-body">
          <input className="form-control" placeholder="搜尋品項名稱、種類或規格" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </div>
      </div>

      <div className="card shadow-sm">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0 status-table">
              <colgroup>
                <col className="status-table-serial" /><col className="status-table-photo" /><col className="status-table-category" />
                <col className="status-table-name" /><col className="status-table-spec" /><col className="status-table-quantity" />
                <col className="status-table-location" /><col className="status-table-detail" /><col className="status-table-action" />
              </colgroup>
              <thead className="table-light"><tr>
                <th>流水號</th><th>照片</th><th>種類</th><th>名稱</th><th>規格</th><th>數量</th><th>據點</th>
                <th>{status === 'globalLowStock' ? '安全庫存' : '效期／庫存分類'}</th><th className="text-center">操作</th>
              </tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="text-center text-muted py-5">載入中…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={9} className="text-center text-muted py-5">目前沒有符合的項目</td></tr>
                ) : filtered.map((r) => {
                  const url = itemPhotoUrl(r.image_path)
                  return (
                    <tr key={r.key}>
                      <td className="text-muted">{r.id ?? '—'}</td>
                      <td>{url ? <img src={url} alt={r.item_name} className="status-table-image" /> : <i className="bi bi-image text-muted fs-4" />}</td>
                      <td>{r.category}</td><td className="fw-semibold">{r.item_name}</td><td>{r.specification ?? '無'}</td>
                      <td>{r.quantity ?? '—'} {r.unit ?? ''}</td>
                      <td>{r.locationId == null ? <span className="badge bg-secondary">全系統</span> : <span className="badge" style={locationColorStyle(r.locationId)}>{locationName(r.locationId)}</span>}</td>
                      <td>{r.expiration ?? (r.stock_type ? <span className={`badge ${stockTypeBadgeClass(r.stock_type)}`}>{stockTypeDisplayName(r.stock_type)}</span> : r.note ?? '—')}</td>
                      <td className="text-center">
                        {status === 'expired' ? (
                          // 已過期：總管直接報廢（不限據點）；幫主只能對「自己據點」申請報廢；其餘無動作。
                          isAdmin && r.id != null ? (
                            <Link className="btn btn-sm btn-dark" to={`/disposals/create?supplyItemId=${r.id}`}>
                              <i className="bi bi-trash3" /> 報廢
                            </Link>
                          ) : isCadre && r.id != null && r.locationId === profile?.location_id ? (
                            <button className="btn btn-sm btn-primary" onClick={() => { setDisposalRow(r); setDisposalReason('已過期') }}>
                              <i className="bi bi-hand-index-thumb" /> 舉手
                            </button>
                          ) : (
                            <span className="text-muted small">—</span>
                          )
                        ) : isAdminOrCadre ? (
                          <button className="btn btn-sm btn-primary" onClick={() => setRaiseRow(r)}>
                            <i className="bi bi-hand-index-thumb" /> 舉手
                          </button>
                        ) : (
                          <span className="text-muted small">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-muted mb-0 mt-3">共 {filtered.length} 項</p>
        </div>
      </div>

      {/* 舉手：提出缺料需求（表單在共用元件） */}
      {raiseRow && (
        <RaiseRequestModal
          target={{
            category: raiseRow.category,
            item_name: raiseRow.item_name,
            specification: raiseRow.specification,
            unit: raiseRow.unit,
            locationId: raiseRow.locationId,
            quantity: raiseRow.quantity,
          }}
          locations={locations}
          items={items}
          onClose={() => setRaiseRow(null)}
          onDone={(flash) => {
            setRaiseRow(null)
            navigate('/', { state: { flash } })
          }}
        />
      )}

      {/* 申請報廢：填寫原因 */}
      {disposalRow && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title"><i className="bi bi-trash3" /> 向總管申請報廢</h5>
                <button type="button" className="btn-close" onClick={() => setDisposalRow(null)} />
              </div>
              <div className="modal-body">
                <div className="alert alert-light border small mb-3">
                  品項：<strong>{disposalRow.item_name}</strong>
                  {disposalRow.specification ? `／${disposalRow.specification}` : ''}（{disposalRow.category}）
                  ，數量 {disposalRow.quantity ?? ''} {disposalRow.unit ?? ''}（已過期）
                </div>
                <label className="form-label">報廢原因 *</label>
                <textarea className="form-control" rows={3} value={disposalReason} onChange={(e) => setDisposalReason(e.target.value)} placeholder="請填寫報廢原因，總管審核時會看到" />
                <div className="form-text">送出後會成為一筆待總管審核的報廢申請。</div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDisposalRow(null)}>取消</button>
                <button type="button" className="btn btn-primary" disabled={disposalSaving || !disposalReason.trim()} onClick={() => void submitDisposalRequest()}>
                  {disposalSaving ? '送出中…' : '送出申請'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
