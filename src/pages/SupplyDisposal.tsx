// 物資報廢 — Create 與出庫／捐贈共用同一套版型（StockBatchPicker + 左表單右說明）。
// 報廢最常見的來源就是過期物資，所以保留即期／已過期快選面板，且從快選帶入
// 已過期批次時會自動把原因設為「過期」。
// 寫入走 disposal-create Edge Function；Index 只是一個受 RLS 限縮的 SELECT。
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { useItemPicker } from '../hooks/useItemPicker'
import { functionErrorMessage } from '../lib/functionError'
import { logActivity } from '../lib/activityLog'
import { locationColorStyle } from '../lib/colors'
import { Roles, AllDisposalReasons, disposalReasonDisplayName, disposalReasonBadgeClass, DisposalReasons } from '../lib/enums'
import { ExpiringItemsPanel, StockBatchPicker } from '../components/StockBatchPicker'
import { DateRangeFilter } from '../components/DateRangeFilter'
 import { withinRange } from '../lib/dateRange'
import { fetchExpiringItems, isExpired } from '../lib/stockBatch'
import { FlashMessage } from '../components/FlashMessage'
import { ConfirmActionModal } from '../components/ConfirmActionModal'
import { exportToExcel } from '../lib/excelExport'
import type { SupplyItem, SupplyLocation, SupplyDisposalLog } from '../types/db'

export function SupplyDisposalCreate() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [locationId, setLocationId] = useState<number | null>(profile?.location_id ?? null)
  const [stockTypeFilter, setStockTypeFilter] = useState('')
  const [expiringItems, setExpiringItems] = useState<SupplyItem[]>([])
  const [pendingItemId, setPendingItemId] = useState<number | null>(null)

  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState<string>(DisposalReasons.Other)
  const [remark, setRemark] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false) // 送出前確認視窗（p.13）

  const picker = useItemPicker(locationId, stockTypeFilter || undefined)
  const { items: pickerItems, setCategory, setItemName, setItemId } = picker
  const selected = picker.currentItem
  const operatorName = profile?.display_name ?? profile?.username ?? ''
  const expiryScope = useMemo(() => (isAdmin ? null : profile?.location_id ?? null), [isAdmin, profile?.location_id])

  useEffect(() => {
    supabase
      .from('supply_location')
      .select('*')
      .eq('is_active', true)
      .order('id')
      .then(({ data }) => setLocations((data ?? []) as SupplyLocation[]))
  }, [])

  useEffect(() => {
    void fetchExpiringItems(expiryScope).then(setExpiringItems)
  }, [expiryScope])

  // 快選要等該據點的物資載入完成才挑得到批次，所以先記在 pendingItemId，
  // 載好後再一次把 種類／名稱／批次 帶入（三個 setter 依序呼叫即為最終值）。
  useEffect(() => {
    if (pendingItemId == null) return
    const target = pickerItems.find((x) => x.id === pendingItemId)
    if (!target) return
    setCategory(target.category)
    setItemName(target.item_name)
    setItemId(target.id)
    setPendingItemId(null)
  }, [pendingItemId, pickerItems, setCategory, setItemName, setItemId])

  function quickPick(item: SupplyItem) {
    setError(null)
    setSuccess(null)
    setStockTypeFilter('')
    setLocationId(item.location_id)
    setPendingItemId(item.id)
    // 已過期的批次直接把原因帶成「過期」，操作人員仍可自行改掉。
    if (isExpired(item)) setReason(DisposalReasons.Expired)
    setQuantity(String(item.quantity))
  }

  // 物資總覽「已過期」清單的「報廢」帶 ?supplyItemId= 進來時：直接抓該批次並帶入
  // （沿用 quickPick：設定據點、選取批次、過期自動帶原因、帶入現有數量）。
  useEffect(() => {
    const id = searchParams.get('supplyItemId')
    if (!id) return
    let cancelled = false
    supabase
      .from('supply_item')
      .select('*')
      .eq('id', Number(id))
      .single()
      .then(({ data }) => {
        if (!cancelled && data) quickPick(data as SupplyItem)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // 切換分類後已選的物資可能不在範圍內，直接清空已選內容。
  function changeStockType(value: string) {
    setStockTypeFilter(value)
    picker.reset()
  }

  function locationName(id: number | null): string {
    if (id == null) return '—'
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!locationId || !selected) {
      setError('請選擇據點與物資')
      return
    }
    const qty = Number(quantity)
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('報廢數量必須是大於 0 的整數')
      return
    }
    if (qty > selected.quantity) {
      setError(`報廢數量超過現有庫存（現有 ${selected.quantity} ${selected.unit ?? ''}）`)
      return
    }
    setConfirmOpen(true)
  }

  async function doDisposal() {
    if (!locationId || !selected) return
    const qty = Number(quantity)
    setSubmitting(true)
    const { data, error: invokeError } = await supabase.functions.invoke('disposal-create', {
      body: {
        supplyItemId: selected.id,
        locationId,
        disposalQuantity: qty,
        reason,
        remark,
      },
    })
    setSubmitting(false)

    // 失敗時要拿 Edge Function 自己的中文訊息：supabase-js 會把非 2xx 的內容
    // 換成 "non-2xx status code"，真正的原因藏在 response body 裡。
    if (invokeError || !data?.success) {
      setConfirmOpen(false)
      setError(data?.message ?? (await functionErrorMessage(invokeError, '報廢失敗')))
      return
    }
    void logActivity({ action: 'disposal', category: '庫存異動', targetTable: 'supply_disposal_log', targetId: selected.id, locationId: Number(locationId), summary: `報廢「${selected.item_name}」${qty} ${selected.unit ?? ''}（${disposalReasonDisplayName(reason)}）`, detail: { reason, remark: remark || null } })
    navigate('/disposals', { state: { flash: data.message } })
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="mb-0">
          <i className="bi bi-trash3" /> 物資報廢
        </h2>
        <Link className="btn btn-outline-secondary" to="/disposals">
          <i className="bi bi-list-ul" /> 報廢紀錄
        </Link>
      </div>
      <hr />

      <ExpiringItemsPanel
        items={expiringItems}
        locations={locations}
        title="即期／已過期物資，請確認是否需要報廢"
        actionLabel="選擇報廢"
        onPick={quickPick}
        defaultCollapsed
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="row g-4">
        <div className="col-lg-8">
          <div className="card shadow-sm">
            <div className="card-body">
              <form onSubmit={handleSubmit}>
                <StockBatchPicker
                  isAdmin={isAdmin}
                  locations={locations}
                  locationId={locationId}
                  onLocationChange={setLocationId}
                  stockTypeFilter={stockTypeFilter}
                  onStockTypeChange={changeStockType}
                  picker={picker}
                />

                <div className="row">
                  <div className="col-md-6 mb-3">
                    <label className="form-label">報廢數量 *</label>
                    <input
                      className="form-control"
                      type="number"
                      min={1}
                      max={selected?.quantity}
                      required
                      disabled={!selected}
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  </div>
                  <div className="col-md-6 mb-3">
                    <label className="form-label">報廢原因 *</label>
                    <select className="form-select" required value={reason} onChange={(e) => setReason(e.target.value)}>
                      {AllDisposalReasons.map((r) => (
                        <option key={r} value={r}>
                          {disposalReasonDisplayName(r)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mb-3">
                  <label className="form-label">操作人員</label>
                  <input className="form-control" disabled value={operatorName} />
                  <div className="form-text">系統會自動記錄目前登入帳號為操作人員。</div>
                </div>

                <div className="mb-3">
                  <label className="form-label">備註</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    placeholder="報廢原因細節或其他說明"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                  />
                </div>

                <div className="d-flex gap-2">
                  <button type="submit" className="btn btn-danger btn-lg" disabled={submitting || !selected}>
                    <i className="bi bi-check-circle" /> {submitting ? '處理中…' : '確認報廢'}
                  </button>
                  <Link className="btn btn-secondary btn-lg" to="/disposals">
                    ← 返回紀錄
                  </Link>
                </div>
              </form>
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="alert alert-info">
            <strong>
              <i className="bi bi-info-circle" /> 報廢說明
            </strong>
            <ul className="mb-0 mt-2">
              <li>先選擇據點，物資選單會自動只顯示該據點的物資</li>
              <li>可搭配分類快速篩選（無效期／有效期／冷凍食品）</li>
              <li>從上方快選帶入已過期批次時，會自動帶出整批數量與「過期」原因</li>
              <li>報廢後物資會直接離開系統庫存</li>
            </ul>
          </div>
          <div className="alert alert-warning">
            <strong>
              <i className="bi bi-exclamation-triangle" /> 注意事項
            </strong>
            <ul className="mb-0 mt-2">
              <li>請確認報廢數量與原因正確</li>
              <li>報廢後無法直接復原</li>
              <li>報廢屬於庫存損耗，請於備註說明處理方式</li>
            </ul>
          </div>
        </div>
      </div>

      {confirmOpen && selected && (
        <ConfirmActionModal
          title="確認本次報廢內容"
          icon="bi-trash3"
          confirmLabel="確認報廢"
          submitting={submitting}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void doDisposal()}
          fields={[
            { label: '報廢原因', value: <span className={`badge ${disposalReasonBadgeClass(reason)}`}>{disposalReasonDisplayName(reason)}</span> },
            { label: '所在據點', value: locationName(locationId) },
            { label: '操作人員', value: operatorName || '—' },
            ...(remark.trim() ? [{ label: '備註', value: remark.trim(), full: true }] : []),
          ]}
          items={[
            {
              name: selected.item_name,
              category: selected.category,
              spec: selected.specification,
              expiration: selected.expiration_date,
              quantity: Number(quantity),
              unit: selected.unit,
              extra: `${selected.quantity - Number(quantity)} ${selected.unit ?? ''}`,
            },
          ]}
          extraHeader="報廢數量"
          extraColHeader="報廢後剩餘"
          warning={<>按下「確認報廢」後會<strong>立刻扣除庫存，且無法直接復原</strong>。請再確認一次品項與數量。</>}
        />
      )}
    </div>
  )
}

export function SupplyDisposalIndex() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const [logs, setLogs] = useState<SupplyDisposalLog[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [items, setItems] = useState<SupplyItem[]>([])
  const [keyword, setKeyword] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [reasonFilter, setReasonFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [logRes, locRes, itemRes] = await Promise.all([
        supabase.from('supply_disposal_log').select('*').order('disposal_time', { ascending: false }).limit(100),
        supabase.from('supply_location').select('*'),
        supabase.from('supply_item').select('id, item_name, specification, unit'),
      ])
      setLogs((logRes.data ?? []) as SupplyDisposalLog[])
      setLocations((locRes.data ?? []) as SupplyLocation[])
      setItems((itemRes.data ?? []) as SupplyItem[])
      setLoading(false)
    }
    void load()
  }, [])

  function itemOf(id: number): SupplyItem | undefined {
    return items.find((i) => i.id === id)
  }

  const myLoc = profile?.location_id ?? null
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // 幫主只看自己據點的報廢紀錄（看不到別據點）；總管不限。
      if (!isAdmin && myLoc != null && log.location_id !== myLoc) return false
      if (locationFilter && log.location_id !== Number(locationFilter)) return false
      if (reasonFilter && log.reason !== reasonFilter) return false
      if (!withinRange(log.disposal_time, fromDate, toDate)) return false
      if (keyword.trim()) {
        const k = keyword.trim().toLowerCase()
        const matches =
          (log.remark ?? '').toLowerCase().includes(k) ||
          (log.operator ?? '').toLowerCase().includes(k) ||
          (itemOf(log.supply_item_id)?.item_name ?? '').toLowerCase().includes(k)
        if (!matches) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, keyword, locationFilter, reasonFilter, fromDate, toDate, items])

  function locationName(id: number): string {
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  function handleExport() {
    exportToExcel<SupplyDisposalLog>('報廢紀錄', '報廢紀錄', [
      { header: '報廢時間', value: (l) => new Date(l.disposal_time).toLocaleDateString('zh-TW') },
      { header: '物資名稱', value: (l) => itemOf(l.supply_item_id)?.item_name ?? `物資 #${l.supply_item_id}` },
      { header: '規格', value: (l) => itemOf(l.supply_item_id)?.specification ?? '' },
      { header: '據點', value: (l) => locationName(l.location_id) },
      { header: '數量', value: (l) => l.disposal_quantity, total: true },
      { header: '單位', value: (l) => itemOf(l.supply_item_id)?.unit ?? '' },
      { header: '原因', value: (l) => disposalReasonDisplayName(l.reason) },
      { header: '操作人員', value: (l) => l.operator ?? '' },
      { header: '備註', value: (l) => l.remark ?? '' },
    ], filteredLogs)
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">
          <i className="bi bi-list-ul" /> 物資報廢紀錄
        </h2>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-success" onClick={handleExport} disabled={filteredLogs.length === 0}>
            <i className="bi bi-file-earmark-excel" /> 匯出 Excel
          </button>
          {/* 報廢建立僅總管；幫主／小幫手改用「舉手／申請報廢」，此處直接隱藏。 */}
          {isAdmin && (
            <Link className="btn btn-primary" to="/disposals/create">
              <i className="bi bi-plus-circle" /> 新增報廢
            </Link>
          )}
        </div>
      </div>
      <FlashMessage />
      <div className="card shadow-sm mb-3">
        <div className="card-header bg-light">
          <i className="bi bi-funnel" /> 篩選條件
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">關鍵字</label>
              <input className="form-control" placeholder="搜尋備註或操作人員" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="col-md-3">
              <label className="form-label">據點</label>
              <select className="form-select" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                <option value="">全部據點</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.location_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">原因</label>
              <select className="form-select" value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)}>
                <option value="">全部原因</option>
                {AllDisposalReasons.map((r) => (
                  <option key={r} value={r}>
                    {disposalReasonDisplayName(r)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">報廢日期區間</label>
              <DateRangeFilter from={fromDate} to={toDate} onFrom={setFromDate} onTo={setToDate} />
            </div>
            <div className="col-md-2 d-flex align-items-end">
              <button
                type="button"
                className="btn btn-secondary w-100"
                onClick={() => {
                  setKeyword('')
                  setLocationFilter('')
                  setReasonFilter('')
                  setFromDate('')
                  setToDate('')
                }}
              >
                <i className="bi bi-arrow-clockwise" /> 重設
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="card shadow-sm">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover">
              <thead className="table-light">
                <tr>
                  <th className="col-min">報廢時間</th>
                  <th>物資名稱</th>
                  <th className="col-min">據點</th>
                  <th className="col-min">數量</th>
                  <th className="col-min">原因</th>
                  <th className="col-min">操作人員</th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center text-muted py-4">
                      載入中…
                    </td>
                  </tr>
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-muted py-4">
                      沒有符合條件的報廢紀錄
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="col-min">{new Date(log.disposal_time).toLocaleDateString('zh-TW')}</td>
                      <td>
                        <strong>{itemOf(log.supply_item_id)?.item_name ?? `物資 #${log.supply_item_id}`}</strong>
                        {itemOf(log.supply_item_id)?.specification ? (
                          <span className="text-muted"> ／{itemOf(log.supply_item_id)?.specification}</span>
                        ) : null}
                      </td>
                      <td className="col-min">
                        <span className="badge" style={locationColorStyle(log.location_id)}>
                          {locationName(log.location_id)}
                        </span>
                      </td>
                      <td className="col-min">
                        {log.disposal_quantity} {itemOf(log.supply_item_id)?.unit ?? ''}
                      </td>
                      <td className="col-min">
                        <span className={`badge ${disposalReasonBadgeClass(log.reason)}`}>{disposalReasonDisplayName(log.reason)}</span>
                      </td>
                      <td className="col-min">{log.operator}</td>
                      <td>{log.remark}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
