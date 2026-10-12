import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { locationColorStyle } from '../lib/colors'
import { Roles, TransferStatuses, transferStatusBadgeClass, transferStatusDisplayName } from '../lib/enums'
import { supabase } from '../lib/supabaseClient'
import { FlashMessage } from '../components/FlashMessage'
import { ConfirmActionModal } from '../components/ConfirmActionModal'
import { OutboundItemPickerModal } from '../components/OutboundModals'
import { expiryAlert } from '../lib/stockBatch'
import { exportToExcel } from '../lib/excelExport'
import { logActivity } from '../lib/activityLog'
import { DateRangeFilter } from '../components/DateRangeFilter'
 import { withinRange } from '../lib/dateRange'
import type { SupplyItem, SupplyLocation, SupplyTransferLog, SupplyRequest } from '../types/db'

// 轉移清單改為與出庫相同的概念：每一列存整個物資批次物件（顯示效期／規格／現有），
// 由挑選視窗加入，數量可累加。
type TransferLine = { item: SupplyItem; quantity: number }

export function SupplyTransferCreate() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [items, setItems] = useState<SupplyItem[]>([])
  const [fromLocationId, setFromLocationId] = useState<number | null>(profile?.location_id ?? null)
  const [toLocationId, setToLocationId] = useState<number | null>(null)
  const [lines, setLines] = useState<TransferLine[]>([])
  const [remark, setRemark] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false) // 送出前確認視窗（p.13）
  const [showItemModal, setShowItemModal] = useState(false)
  const operatorName = profile?.display_name ?? profile?.username ?? ''

  useEffect(() => {
    Promise.all([
      supabase.from('supply_location').select('*').eq('is_active', true).order('id'),
      supabase.from('supply_item').select('*').eq('is_active', true).gt('quantity', 0).order('item_name'),
    ]).then(([locRes, itemRes]) => {
      setLocations((locRes.data ?? []) as SupplyLocation[])
      setItems((itemRes.data ?? []) as SupplyItem[])
    })
  }, [])

  // 物資清單「物資轉移」按鈕帶 ?supplyItemId= 進來時，預選轉出據點與該筆物資。
  useEffect(() => {
    const id = searchParams.get('supplyItemId')
    if (!id || items.length === 0) return
    const target = items.find((x) => x.id === Number(id))
    if (!target) return
    setFromLocationId(target.location_id)
    setLines([{ item: target, quantity: 1 }])
  }, [searchParams, items])

  // 物資總覽「待處理需求」的「轉移補貨」帶 ?requestId= 進來時：來源=需求指定的轉出據點、
  // 目標=需求據點，並在轉出據點找符合品項的批次、帶入需求數量。
  useEffect(() => {
    const reqId = searchParams.get('requestId')
    if (!reqId || items.length === 0) return
    let cancelled = false
    supabase
      .from('supply_request')
      .select('*')
      .eq('id', Number(reqId))
      .single()
      .then(({ data }) => {
        if (cancelled || !data) return
        const req = data as SupplyRequest
        if (req.source_location_id) setFromLocationId(req.source_location_id)
        setToLocationId(req.requesting_location_id)
        const match = items.find(
          (x) =>
            x.location_id === req.source_location_id &&
            x.category === req.category &&
            x.item_name === req.item_name &&
            (x.specification ?? '') === (req.specification ?? '')
        )
        setLines(match ? [{ item: match, quantity: req.quantity }] : [])
      })
    return () => {
      cancelled = true
    }
  }, [searchParams, items])

  const sourceItems = useMemo(() => items.filter((x) => x.location_id === fromLocationId && x.quantity > 0), [items, fromLocationId])
  const totalQuantity = lines.reduce((sum, l) => sum + l.quantity, 0)

  // 扣掉清單裡已加入同批次的數量後，這個批次還剩多少可轉移。
  function remainingOf(item: SupplyItem): number {
    const used = lines.filter((l) => l.item.id === item.id).reduce((s, l) => s + l.quantity, 0)
    return item.quantity - used
  }

  // 加入物資：同批次已在清單就累加數量，否則新增一列。
  function addLine(item: SupplyItem, quantity: number) {
    setLines((current) => {
      const existing = current.find((l) => l.item.id === item.id)
      if (existing) return current.map((l) => (l.item.id === item.id ? { ...l, quantity: Math.min(item.quantity, l.quantity + quantity) } : l))
      return [...current, { item, quantity }]
    })
    setShowItemModal(false)
  }

  function updateLineQuantity(itemId: number, value: string) {
    const n = Number(value)
    setLines((current) => current.map((l) => (l.item.id === itemId ? { ...l, quantity: Number.isFinite(n) ? n : 0 } : l)))
  }

  function removeLine(itemId: number) {
    setLines((current) => current.filter((l) => l.item.id !== itemId))
  }

  function locationName(id: number | null): string {
    if (id == null) return '—'
    return locations.find((x) => x.id === id)?.location_name ?? `#${id}`
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (!fromLocationId || !toLocationId || fromLocationId === toLocationId) {
      setError('請選擇不同的轉出與入庫據點')
      return
    }
    if (lines.length === 0) {
      setError('請至少加入一項要轉移的物資')
      return
    }
    if (lines.some((x) => x.quantity <= 0 || x.quantity > x.item.quantity)) {
      setError('每一項的轉移數量必須大於 0 且不超過現有庫存')
      return
    }
    setConfirmOpen(true)
  }

  async function doTransfer() {
    setSubmitting(true)
    const { data, error: invokeError } = await supabase.functions.invoke('transfer-create', {
      body: {
        fromLocationId,
        toLocationId,
        lines: lines.map((x) => ({ supplyItemId: x.item.id, transferQuantity: x.quantity })),
        remark,
      },
    })
    setSubmitting(false)
    if (invokeError || !data?.success) {
      setConfirmOpen(false)
      setError(data?.message ?? invokeError?.message ?? '建立轉移失敗')
      return
    }
    const totalQty = lines.reduce((s, x) => s + x.quantity, 0)
    void logActivity({ action: 'transfer_create', category: '庫存異動', targetTable: 'supply_transfer_log', locationId: fromLocationId ? Number(fromLocationId) : null, summary: `建立轉移（${lines.length} 項、共 ${totalQty} 件），扣來源庫存`, detail: { fromLocationId, toLocationId, lines: lines.map((x) => ({ name: x.item.item_name, quantity: x.quantity })) } })
    navigate('/transfers', { state: { flash: data.message } })
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="mb-0"><i className="bi bi-arrow-left-right" /> 物資轉移</h2>
        <Link className="btn btn-outline-secondary" to="/transfers"><i className="bi bi-list-ul" /> 轉移紀錄</Link>
      </div>
      <hr />
      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="row">
        <div className="col-lg-8">
          <form onSubmit={submit}>
            {/* 步驟一：轉出與入庫據點 */}
            <div className="card shadow-sm mb-4">
              <div className="card-header bg-light"><i className="bi bi-geo" /> 步驟一：轉出與入庫據點</div>
              <div className="card-body">
                <div className="row">
                  <div className="col-md-6 mb-3">
                    <label className="form-label">轉出據點 *</label>
                    {isAdmin ? (
                      <select className="form-select" required value={fromLocationId ?? ''} onChange={(e) => { setFromLocationId(e.target.value ? Number(e.target.value) : null); setLines([]) }}>
                        <option value="">請選擇轉出據點</option>{locations.map((x) => <option key={x.id} value={x.id}>{x.location_name}</option>)}
                      </select>
                    ) : <input className="form-control" disabled value={locations.find((x) => x.id === fromLocationId)?.location_name ?? ''} />}
                    {!isAdmin && <div className="form-text">已鎖定為你的所屬據點；只有最高權限管理人員能切換。</div>}
                  </div>
                  <div className="col-md-6 mb-3">
                    <label className="form-label">入庫據點 *</label>
                    <select className="form-select" required value={toLocationId ?? ''} onChange={(e) => setToLocationId(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">請選擇入庫據點</option>{locations.filter((x) => x.id !== fromLocationId).map((x) => <option key={x.id} value={x.id}>{x.location_name}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* 步驟二：轉移清單（批次） */}
            <div className="card shadow-sm mb-4">
              <div className="card-header bg-light d-flex justify-content-between align-items-center">
                <span><i className="bi bi-list-check" /> 步驟二：轉移清單</span>
                <button type="button" className="btn btn-sm btn-primary" disabled={!fromLocationId} onClick={() => { setError(null); setShowItemModal(true) }}>
                  <i className="bi bi-plus-circle" /> 新增物資
                </button>
              </div>
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>物資</th>
                      <th className="col-min">規格／批次</th>
                      <th className="col-min">效期</th>
                      <th className="col-min">現有庫存</th>
                      <th className="col-min" style={{ width: 140 }}>轉移數量</th>
                      <th className="col-min" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr><td colSpan={6} className="text-center text-muted py-4">{fromLocationId ? '尚未加入任何物資，請按右上角「新增物資」' : '請先選擇轉出據點'}</td></tr>
                    ) : lines.map((l) => {
                      const alert = expiryAlert(l.item)
                      const over = l.quantity > l.item.quantity
                      return (
                        <tr key={l.item.id}>
                          <td><strong>{l.item.item_name}</strong><div className="text-muted small">{l.item.category}</div></td>
                          <td className="col-min">{l.item.specification?.trim() || '無'}</td>
                          <td className="col-min">{l.item.expiration_date ?? '無效期'}{alert && <span className={`badge ms-1 ${alert.badgeClass}`}>{alert.label}</span>}</td>
                          <td className="col-min">{l.item.quantity} {l.item.unit ?? ''}</td>
                          <td className="col-min">
                            <input className={`form-control form-control-sm ${over ? 'is-invalid' : ''}`} type="number" min={1} max={l.item.quantity} value={l.quantity} onChange={(e) => updateLineQuantity(l.item.id, e.target.value)} />
                          </td>
                          <td className="col-min text-end"><button type="button" className="btn btn-sm btn-outline-danger" title="移除" onClick={() => removeLine(l.item.id)}><i className="bi bi-trash" /></button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {lines.length > 0 && (
                    <tfoot className="table-light"><tr><td colSpan={4} className="text-end fw-bold">合計</td><td className="fw-bold">{lines.length} 項／{totalQuantity} 件</td><td /></tr></tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* 操作人員 + 備註 + 送出 */}
            <div className="card shadow-sm">
              <div className="card-body">
                <div className="mb-3">
                  <label className="form-label">操作人員</label>
                  <input className="form-control" disabled value={operatorName} />
                  <div className="form-text">系統會自動記錄目前登入帳號為操作人員。</div>
                </div>
                <div className="mb-3">
                  <label className="form-label">備註</label>
                  <textarea className="form-control" rows={3} placeholder="轉移原因或其他說明（整批共用）" value={remark} onChange={(e) => setRemark(e.target.value)} />
                </div>
                <div className="d-flex gap-2">
                  <button type="submit" className="btn btn-primary btn-lg" disabled={submitting || lines.length === 0}><i className="bi bi-check-circle" /> 建立轉移（{lines.length} 項）</button>
                  <Link className="btn btn-secondary btn-lg" to="/transfers">← 返回紀錄</Link>
                </div>
              </div>
            </div>
          </form>
        </div>

        <div className="col-lg-4">
          <div className="alert alert-info">
            <strong><i className="bi bi-info-circle" /> 轉移說明</strong>
            <ul className="mb-0 mt-2">
              <li>先選轉出與入庫據點，再一項一項加入要轉移的批次</li>
              <li>物資清單只會顯示轉出據點的庫存；只有最高權限管理人員能切換來源</li>
              <li>同一個批次重複加入會自動累加數量</li>
            </ul>
          </div>
          <div className="alert alert-warning">
            <strong><i className="bi bi-exclamation-triangle" /> 到貨確認</strong>
            <ul className="mb-0 mt-2">
              <li>建立時先扣除來源庫存</li>
              <li>入庫據點確認後才會入庫</li>
              <li>取消會退回來源庫存</li>
            </ul>
          </div>
        </div>
      </div>

      {showItemModal && (
        <OutboundItemPickerModal
          items={sourceItems}
          loading={false}
          remainingOf={remainingOf}
          onCancel={() => setShowItemModal(false)}
          onAdd={addLine}
          title="加入要轉移的物資"
          quantityLabel="轉移數量"
          availableLabel="可轉移數量"
          emptyText="這個據點沒有符合條件的可轉移物資"
        />
      )}

      {confirmOpen && (
        <ConfirmActionModal
          title="確認本次轉移內容"
          icon="bi-arrow-left-right"
          confirmLabel="確定轉移"
          submitting={submitting}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void doTransfer()}
          fields={[
            { label: '轉出據點', value: locationName(fromLocationId) },
            { label: '入庫據點', value: locationName(toLocationId) },
            ...(remark.trim() ? [{ label: '備註', value: remark.trim(), full: true }] : []),
          ]}
          items={lines.map((l) => ({
            name: l.item.item_name,
            category: l.item.category,
            spec: l.item.specification,
            expiration: l.item.expiration_date,
            quantity: l.quantity,
            unit: l.item.unit,
            extra: `${l.item.quantity - l.quantity} ${l.item.unit ?? ''}`,
          }))}
          extraHeader="轉移數量"
          extraColHeader="轉移後來源剩餘"
          warning={<>按下「確定轉移」後會<strong>立刻扣除轉出據點庫存</strong>，待入庫據點確認到貨後才入庫。請再確認一次品項與數量。</>}
        />
      )}
    </div>
  )
}

export function SupplyTransferIndex() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const canCreate = isAdmin || profile?.role_name === Roles.Cadre
  const [logs, setLogs] = useState<SupplyTransferLog[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [items, setItems] = useState<SupplyItem[]>([])
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'danger'; text: string } | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [logRes, locRes, itemRes] = await Promise.all([
      supabase.from('supply_transfer_log').select('*').order('transfer_time', { ascending: false }).limit(100),
      supabase.from('supply_location').select('*'),
      supabase.from('supply_item').select('*'),
    ])
    setLogs((logRes.data ?? []) as SupplyTransferLog[])
    setLocations((locRes.data ?? []) as SupplyLocation[])
    setItems((itemRes.data ?? []) as SupplyItem[])
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    return logs.filter((x) => {
      if (statusFilter && x.status !== statusFilter) return false
      if (locationFilter && x.from_location_id !== Number(locationFilter) && x.to_location_id !== Number(locationFilter)) return false
      if (!withinRange(x.transfer_time, fromDate, toDate)) return false
      if (k) {
        const item = items.find((i) => i.id === x.supply_item_id)
        if (![item?.item_name, x.operator, x.remark].some((v) => (v ?? '').toLowerCase().includes(k))) return false
      }
      return true
    })
  }, [logs, items, keyword, statusFilter, locationFilter, fromDate, toDate])

  async function resolve(functionName: 'transfer-confirm' | 'transfer-cancel', logId: number) {
    setMessage(null)
    const { data, error } = await supabase.functions.invoke(functionName, { body: { logId } })
    if (error || !data?.success) setMessage({ type: 'danger', text: data?.message ?? error?.message ?? '操作失敗' })
    else {
      void logActivity({ action: functionName === 'transfer-confirm' ? 'transfer_confirm' : 'transfer_cancel', category: '庫存異動', targetTable: 'supply_transfer_log', targetId: logId, summary: functionName === 'transfer-confirm' ? `確認轉移送達 #${logId}（入庫目的據點）` : `取消轉移 #${logId}（退回來源）` })
      setMessage({ type: 'success', text: data.message }); await load()
    }
  }
  const locationName = (id: number) => locations.find((x) => x.id === id)?.location_name ?? `#${id}`
  const itemOf = (id: number) => items.find((x) => x.id === id)

  function handleExport() {
    exportToExcel<SupplyTransferLog>('物資轉移紀錄', '轉移紀錄', [
      { header: '轉移時間', value: (l) => new Date(l.transfer_time).toLocaleDateString('zh-TW') },
      { header: '物資', value: (l) => itemOf(l.supply_item_id)?.item_name ?? `#${l.supply_item_id}` },
      { header: '規格', value: (l) => itemOf(l.supply_item_id)?.specification ?? '' },
      { header: '轉出據點', value: (l) => locationName(l.from_location_id) },
      { header: '入庫據點', value: (l) => locationName(l.to_location_id) },
      { header: '數量', value: (l) => l.transfer_quantity, total: true },
      { header: '單位', value: (l) => itemOf(l.supply_item_id)?.unit ?? '' },
      { header: '狀態', value: (l) => transferStatusDisplayName(l.status) },
      { header: '確認人', value: (l) => l.confirmed_by ?? '' },
      { header: '確認時間', value: (l) => (l.confirmed_at ? new Date(l.confirmed_at).toLocaleDateString('zh-TW') : '') },
      { header: '操作人員', value: (l) => l.operator ?? '' },
      { header: '備註', value: (l) => l.remark ?? '' },
    ], filtered)
  }

  return <div className="container-fluid mt-4">
    <div className="d-flex justify-content-between align-items-center mb-4"><h2><i className="bi bi-list-ul" /> 物資轉移紀錄</h2><div className="d-flex gap-2"><button className="btn btn-outline-success" onClick={handleExport} disabled={filtered.length === 0}><i className="bi bi-file-earmark-excel" /> 匯出 Excel</button>{canCreate && <Link className="btn btn-primary" to="/transfers/create"><i className="bi bi-plus-circle" /> 新增轉移</Link>}</div></div>
    <FlashMessage />
    {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}
    <div className="card shadow-sm mb-3"><div className="card-header bg-light"><i className="bi bi-funnel" /> 篩選條件</div><div className="card-body"><div className="row g-3">
      <div className="col-md-4"><label className="form-label">關鍵字</label><input className="form-control" placeholder="搜尋物資名稱、操作人員或備註" value={keyword} onChange={(e) => setKeyword(e.target.value)} /></div>
      <div className="col-md-3"><label className="form-label">狀態</label><select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
        <option value="">全部狀態</option>
        {Object.values(TransferStatuses).map((s) => <option key={s} value={s}>{transferStatusDisplayName(s)}</option>)}
      </select></div>
      <div className="col-md-3"><label className="form-label">據點（來源或目標）</label><select className="form-select" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
        <option value="">全部據點</option>
        {locations.map((x) => <option key={x.id} value={x.id}>{x.location_name}</option>)}
      </select></div>
      <div className="col-md-4"><label className="form-label">轉移日期區間</label><DateRangeFilter from={fromDate} to={toDate} onFrom={setFromDate} onTo={setToDate} /></div>
      <div className="col-md-2 d-flex align-items-end"><button type="button" className="btn btn-secondary w-100" onClick={() => { setKeyword(''); setStatusFilter(''); setLocationFilter(''); setFromDate(''); setToDate('') }}><i className="bi bi-arrow-clockwise" /> 重設</button></div>
    </div></div></div>
    <div className="card shadow-sm"><div className="card-body"><div className="table-responsive"><table className="table table-hover align-middle">
      <thead className="table-light"><tr><th>轉移時間</th><th>物資</th><th>來源</th><th /><th>目標</th><th>數量</th><th>狀態</th><th>操作人員</th><th>備註</th><th>動作</th></tr></thead>
      <tbody>{loading ? <tr><td colSpan={10} className="text-center py-4 text-muted">載入中…</td></tr> : filtered.length === 0 ? <tr><td colSpan={10} className="text-center py-4 text-muted">沒有符合條件的轉移紀錄</td></tr> : filtered.map((log) => {
        const item = items.find((x) => x.id === log.supply_item_id)
        // 轉入單位確認送達；轉出單位取消。管理員可執行兩種動作。
        // 後端 Edge Function 會再次驗證，這裡僅控制可見的操作按鈕。
        const canConfirm = isAdmin || profile?.location_id === log.to_location_id
        const canCancel = isAdmin || profile?.location_id === log.from_location_id
        return <tr key={log.id}>
          <td>{new Date(log.transfer_time).toLocaleDateString('zh-TW')}</td><td><strong>{item?.item_name ?? `物資 #${log.supply_item_id}`}</strong>{item?.specification && <div className="small text-muted">{item.specification}</div>}</td>
          <td><span className="badge" style={locationColorStyle(log.from_location_id)}>{locationName(log.from_location_id)}</span></td><td><i className="bi bi-arrow-right-circle text-primary" /></td><td><span className="badge" style={locationColorStyle(log.to_location_id)}>{locationName(log.to_location_id)}</span></td>
          <td><strong>{log.transfer_quantity}</strong> {item?.unit}</td><td><span className={`badge ${transferStatusBadgeClass(log.status)}`}>{transferStatusDisplayName(log.status)}</span>{log.confirmed_by && <div className="small text-muted">{log.confirmed_by}<br />{log.confirmed_at && new Date(log.confirmed_at).toLocaleDateString('zh-TW')}</div>}</td>
          <td>{log.operator}</td><td>{log.remark}</td><td>{log.status === TransferStatuses.Pending && <div className="d-flex gap-1">
            {canConfirm && <button className="btn btn-success btn-sm" onClick={() => void resolve('transfer-confirm', log.id)}>確認送達</button>}
            {canCancel && <button className="btn btn-outline-danger btn-sm" onClick={() => void resolve('transfer-cancel', log.id)}>取消</button>}
            {!canConfirm && !canCancel && <span className="small text-muted">僅轉出／轉入單位可操作</span>}
          </div>}</td>
        </tr>
      })}</tbody>
    </table></div></div></div>
  </div>
}
