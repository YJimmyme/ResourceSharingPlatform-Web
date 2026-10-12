// 捐贈紀錄 — 入庫來源紀錄（supply_stock_in_log）的檢視與維護。
// 「物資捐贈」頁已移除：捐贈人一律在「物資入庫」時填寫；入庫當下沒填的，
// 可在這裡補登、修改或刪除捐贈人資料。編輯／刪除只更新來源紀錄，不影響庫存數量。
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { locationColorStyle } from '../lib/colors'
import { FlashMessage } from '../components/FlashMessage'
import { DateRangeFilter } from '../components/DateRangeFilter'
 import { withinRange } from '../lib/dateRange'
import { exportToExcel } from '../lib/excelExport'
import { logActivity } from '../lib/activityLog'
import { statusColorMap } from '../lib/statusColors'
import { useAuth } from '../hooks/useAuth'
import { Roles } from '../lib/enums'
import { RaiseRequestModal, type RaiseTarget } from '../components/RaiseRequestModal'
import type { SupplyItem, SupplyLocation, SupplyStockInLog } from '../types/db'

export function SupplyDonationIndex() {
  const [logs, setLogs] = useState<SupplyStockInLog[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [items, setItems] = useState<SupplyItem[]>([])
  // 總量不足／啟動募資：直接內嵌顯示（與物資總覽同一來源 global_low_stock_view）
  const [globalLow, setGlobalLow] = useState<{ category: string; item_name: string; specification: string | null; unit: string; total_quantity: number; global_threshold: number }[]>([])
  const [keyword, setKeyword] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [filledFilter, setFilledFilter] = useState('') // '' 全部 / filled 已填捐贈人 / empty 待補登
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 編輯捐贈人（補登/修改）
  const [editRow, setEditRow] = useState<SupplyStockInLog | null>(null)
  const [editForm, setEditForm] = useState({ donorName: '', donorContact: '', donorAddress: '', remark: '' })
  const [saving, setSaving] = useState(false)

  // 舉手調貨（對總量不足品項提出缺料需求）
  const { profile } = useAuth()
  const [raiseTarget, setRaiseTarget] = useState<RaiseTarget | null>(null)
  // 舉手權限：總管與幫主可用，小幫手無（與權限設計一致）。
  const canRaise = profile?.role_name === Roles.Admin || profile?.role_name === Roles.Cadre

  async function load() {
    setLoading(true)
    const [logRes, locRes, itemRes, glowRes] = await Promise.all([
      supabase.from('supply_stock_in_log').select('*').order('stock_in_time', { ascending: false }).limit(300),
      supabase.from('supply_location').select('*'),
      supabase.from('supply_item').select('id, item_name, category, specification, unit, quantity, location_id'),
      supabase.from('global_low_stock_view').select('category, item_name, specification, unit, total_quantity, global_threshold'),
    ])
    if (logRes.error) setError(logRes.error.message)
    setLogs((logRes.data ?? []) as SupplyStockInLog[])
    setLocations((locRes.data ?? []) as SupplyLocation[])
    setItems((itemRes.data ?? []) as SupplyItem[])
    setGlobalLow((glowRes.data ?? []) as typeof globalLow)
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])

  function itemOf(id: number): SupplyItem | undefined {
    return items.find((i) => i.id === id)
  }
  function locationName(id: number): string {
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (locationFilter && log.location_id !== Number(locationFilter)) return false
      if (!withinRange(log.stock_in_time, fromDate, toDate)) return false
      if (filledFilter === 'filled' && !log.donor_name) return false
      if (filledFilter === 'empty' && log.donor_name) return false
      if (keyword.trim()) {
        const k = keyword.trim().toLowerCase()
        const matches =
          (log.donor_name ?? '').toLowerCase().includes(k) ||
          (log.donor_contact ?? '').toLowerCase().includes(k) ||
          (log.donor_address ?? '').toLowerCase().includes(k) ||
          (log.operator ?? '').toLowerCase().includes(k) ||
          (itemOf(log.supply_item_id)?.item_name ?? '').toLowerCase().includes(k)
        if (!matches) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, keyword, locationFilter, filledFilter, fromDate, toDate, items])

  function handleExport() {
    exportToExcel<SupplyStockInLog>('捐贈紀錄', '捐贈紀錄', [
      { header: '入庫時間', value: (l) => new Date(l.stock_in_time).toLocaleDateString('zh-TW') },
      { header: '物資名稱', value: (l) => itemOf(l.supply_item_id)?.item_name ?? `物資 #${l.supply_item_id}` },
      { header: '規格', value: (l) => itemOf(l.supply_item_id)?.specification ?? '' },
      { header: '據點', value: (l) => locationName(l.location_id) },
      { header: '數量', value: (l) => l.stock_in_quantity, total: true },
      { header: '單位', value: (l) => itemOf(l.supply_item_id)?.unit ?? '' },
      { header: '捐贈者', value: (l) => l.donor_name ?? '' },
      { header: '聯絡電話', value: (l) => l.donor_contact ?? '' },
      { header: '聯絡地址', value: (l) => l.donor_address ?? '' },
      { header: '操作人員', value: (l) => l.operator ?? '' },
      // 範本要求：沒有捐贈者的入庫紀錄（例如純入庫、系統轉移）不列入捐贈紀錄匯出。
    ], filteredLogs.filter((l) => (l.donor_name ?? '').trim() !== ''))
  }

  function openEdit(row: SupplyStockInLog) {
    setEditRow(row)
    setEditForm({
      donorName: row.donor_name ?? '',
      donorContact: row.donor_contact ?? '',
      donorAddress: row.donor_address ?? '',
      remark: row.remark ?? '',
    })
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editRow) return
    setSaving(true)
    setError(null)
    // 只更新來源紀錄的捐贈人欄位，不動庫存。
    const { error: updErr } = await supabase
      .from('supply_stock_in_log')
      .update({
        donor_name: editForm.donorName.trim() || null,
        donor_contact: editForm.donorContact.trim() || null,
        donor_address: editForm.donorAddress.trim() || null,
        remark: editForm.remark.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editRow.id)
    setSaving(false)
    if (updErr) {
      setError(updErr.message)
      return
    }
    void logActivity({ action: 'donation_edit', category: '資料維護', targetTable: 'supply_stock_in_log', targetId: editRow.id, locationId: editRow.location_id, summary: `補登/編輯捐贈人「${editForm.donorName.trim() || '（清空）'}」` })
    setEditRow(null)
    void load()
  }

  async function handleDelete(row: SupplyStockInLog) {
    if (!confirm('確定刪除這筆捐贈（入庫來源）紀錄嗎？此動作只移除捐贈人紀錄，不會影響庫存數量。')) return
    const { error: delErr } = await supabase.from('supply_stock_in_log').delete().eq('id', row.id)
    if (delErr) {
      setError(delErr.message)
      return
    }
    void logActivity({ action: 'donation_delete', category: '資料維護', targetTable: 'supply_stock_in_log', targetId: row.id, locationId: row.location_id, summary: `刪除捐贈來源紀錄 #${row.id}（不影響庫存）` })
    void load()
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="mb-0">
          <i className="bi bi-award" /> 捐贈紀錄
        </h2>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-success" onClick={handleExport} disabled={filteredLogs.length === 0}>
            <i className="bi bi-file-earmark-excel" /> 匯出 Excel
          </button>
          <Link className="btn btn-primary" to="/stock-in">
            <i className="bi bi-box-arrow-in-down" /> 物資入庫
          </Link>
        </div>
      </div>
      <p className="text-muted">捐贈人於「物資入庫」時填寫；入庫當下沒填的，可在這裡補登、修改或刪除（不影響庫存）。</p>
      <FlashMessage />
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card shadow-sm mb-3">
        <div className="card-header bg-light">
          <i className="bi bi-funnel" /> 篩選條件
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-5">
              <label className="form-label">關鍵字</label>
              <input className="form-control" placeholder="搜尋捐贈者、電話、地址、操作人員或物資" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="col-md-2">
              <label className="form-label">捐贈人</label>
              <select className="form-select" value={filledFilter} onChange={(e) => setFilledFilter(e.target.value)}>
                <option value="">全部</option>
                <option value="filled">已填捐贈人</option>
                <option value="empty">待補登</option>
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">據點</label>
              <select className="form-select" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                <option value="">全部據點</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.location_name}</option>
                ))}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">入庫日期區間</label>
              <DateRangeFilter from={fromDate} to={toDate} onFrom={setFromDate} onTo={setToDate} />
            </div>
            <div className="col-md-2 d-flex align-items-end">
              <button type="button" className="btn btn-secondary w-100" onClick={() => { setKeyword(''); setLocationFilter(''); setFilledFilter(''); setFromDate(''); setToDate('') }}>
                <i className="bi bi-arrow-clockwise" /> 重設
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-md-8">
          <div className="card shadow-sm">
            <div className="card-body">
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th className="col-min">入庫時間</th>
                      <th>物資名稱</th>
                      <th className="col-min">據點</th>
                      <th className="col-min">數量</th>
                      <th>捐贈者</th>
                      <th>聯絡方式</th>
                      <th className="col-min">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={7} className="text-center text-muted py-4">載入中…</td></tr>
                    ) : filteredLogs.length === 0 ? (
                      <tr><td colSpan={7} className="text-center text-muted py-4">沒有符合條件的紀錄</td></tr>
                    ) : (
                      filteredLogs.map((log) => (
                        <tr key={log.id}>
                          <td className="col-min">{new Date(log.stock_in_time).toLocaleDateString('zh-TW')}</td>
                          <td>
                            <strong>{itemOf(log.supply_item_id)?.item_name ?? `物資 #${log.supply_item_id}`}</strong>
                            {itemOf(log.supply_item_id)?.specification ? <span className="text-muted"> ／{itemOf(log.supply_item_id)?.specification}</span> : null}
                          </td>
                          <td className="col-min">
                            <span className="badge" style={locationColorStyle(log.location_id)}>{locationName(log.location_id)}</span>
                          </td>
                          <td className="col-min">{log.stock_in_quantity} {itemOf(log.supply_item_id)?.unit ?? ''}</td>
                          <td>
                            {log.donor_name ? (
                              <>
                                <strong>{log.donor_name}</strong>
                                {log.donor_address ? <div className="small text-muted">{log.donor_address}</div> : null}
                              </>
                            ) : (
                              <span className="badge bg-warning text-dark">待補登</span>
                            )}
                          </td>
                          <td>{log.donor_contact ?? '—'}</td>
                          <td className="col-min text-nowrap">
                            <button className="btn btn-sm btn-outline-primary me-1" onClick={() => openEdit(log)}>
                              <i className="bi bi-pencil" /> {log.donor_name ? '編輯' : '補登'}
                            </button>
                            <button className="btn btn-sm btn-outline-danger" onClick={() => void handleDelete(log)}>
                              <i className="bi bi-trash" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-3"><p className="text-muted mb-0">共 {filteredLogs.length} 筆</p></div>
            </div>
          </div>
        </div>
        <div className="col-md-4">
          {/* 總量不足／啟動募資：直接內嵌清單（與物資總覽同一來源） */}
          <div className="card shadow-sm border-0 h-100">
            <div className="card-header" style={{ backgroundColor: statusColorMap.globalLowStock.bg, color: statusColorMap.globalLowStock.text }}>
              <i className={`bi ${statusColorMap.globalLowStock.icon}`} /> {statusColorMap.globalLowStock.label}（{globalLow.length}）
            </div>
            <div className="card-body p-0" style={{ maxHeight: 420, overflowY: 'auto' }}>
              {globalLow.length === 0 ? (
                <p className="text-muted mb-0 p-3">目前沒有總量不足的品項</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>品項</th>
                        <th className="text-end">現有</th>
                        <th className="text-end">門檻</th>
                        <th className="text-end">觸發點</th>
                        {canRaise && <th className="text-center">舉手</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {globalLow.map((g, i) => (
                        <tr key={i}>
                          <td>{g.item_name}{g.specification ? `／${g.specification}` : ''}</td>
                          <td className="text-end text-danger fw-semibold">{g.total_quantity}</td>
                          <td className="text-end">{g.global_threshold}</td>
                          <td className="text-end">{Math.floor(g.global_threshold * 0.9)}</td>
                          {canRaise && (
                            <td className="text-center">
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                title="向有庫存的據點調貨"
                                onClick={() =>
                                  setRaiseTarget({
                                    category: g.category,
                                    item_name: g.item_name,
                                    specification: g.specification,
                                    unit: g.unit,
                                    locationId: null,
                                    quantity: g.total_quantity,
                                  })
                                }
                              >
                                <i className="bi bi-hand-index-thumb" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 編輯／補登捐贈人 */}
      {editRow && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <form onSubmit={saveEdit}>
                <div className="modal-header">
                  <h5 className="modal-title"><i className="bi bi-person-heart" /> 捐贈人資料</h5>
                  <button type="button" className="btn-close" onClick={() => setEditRow(null)} />
                </div>
                <div className="modal-body">
                  <div className="alert alert-light border small mb-3">
                    {itemOf(editRow.supply_item_id)?.item_name ?? `物資 #${editRow.supply_item_id}`}
                    ｜{locationName(editRow.location_id)}｜{editRow.stock_in_quantity} {itemOf(editRow.supply_item_id)?.unit ?? ''}
                    <div className="text-muted">只更新捐贈人資料，不會影響庫存數量。</div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">捐贈人姓名</label>
                    <input className="form-control" placeholder="例如：陳先生／某某企業（留空表示匿名）" value={editForm.donorName} onChange={(e) => setEditForm({ ...editForm, donorName: e.target.value })} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">捐贈者電話</label>
                    <input className="form-control" placeholder="例如：0912-345-678" value={editForm.donorContact} onChange={(e) => setEditForm({ ...editForm, donorContact: e.target.value })} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">捐贈者地址</label>
                    <input className="form-control" placeholder="例如：雲林縣斗六市…" value={editForm.donorAddress} onChange={(e) => setEditForm({ ...editForm, donorAddress: e.target.value })} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">備註</label>
                    <textarea className="form-control" rows={2} value={editForm.remark} onChange={(e) => setEditForm({ ...editForm, remark: e.target.value })} />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setEditRow(null)}>取消</button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '儲存中…' : '儲存'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 舉手：向有庫存的據點調貨（共用元件） */}
      {raiseTarget && (
        <RaiseRequestModal
          target={raiseTarget}
          locations={locations}
          items={items}
          onClose={() => setRaiseTarget(null)}
          onDone={(flash) => {
            setRaiseTarget(null)
            alert(flash)
          }}
        />
      )}
    </div>
  )
}
