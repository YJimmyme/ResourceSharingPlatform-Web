// 操作紀錄（稽核 Log）— 系統管理，僅總管。
// 集中顯示 activity_log：誰、何時、做了什麼（登入/庫存異動/資料維護/申請）。
// 可用 關鍵字 / 分類 / 據點 / 日期區間 篩選，並匯出 Excel。
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { exportToExcel } from '../lib/excelExport'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { withinRange } from '../lib/dateRange'
import { roleDisplayName } from '../lib/enums'
import type { SupplyLocation } from '../types/db'

interface ActivityRow {
  id: number
  occurred_at: string
  actor_name: string | null
  actor_role: string | null
  action: string
  category: string
  target_table: string | null
  target_id: string | null
  location_id: number | null
  summary: string | null
  detail: unknown
}

const CATEGORIES = ['登入', '庫存異動', '資料維護', '申請'] as const

const categoryBadge: Record<string, string> = {
  登入: 'bg-secondary',
  庫存異動: 'bg-primary',
  資料維護: 'bg-info text-dark',
  申請: 'bg-warning text-dark',
}

export function ActivityLog() {
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [keyword, setKeyword] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailRow, setDetailRow] = useState<ActivityRow | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [logRes, locRes] = await Promise.all([
        supabase.from('activity_log').select('*').order('occurred_at', { ascending: false }).limit(1000),
        supabase.from('supply_location').select('*'),
      ])
      setRows((logRes.data ?? []) as ActivityRow[])
      setLocations((locRes.data ?? []) as SupplyLocation[])
      setLoading(false)
    }
    void load()
  }, [])

  function locationName(id: number | null): string {
    if (id == null) return '—'
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    return rows.filter((r) => {
      if (categoryFilter && r.category !== categoryFilter) return false
      if (locationFilter && r.location_id !== Number(locationFilter)) return false
      if (!withinRange(r.occurred_at, fromDate, toDate)) return false
      if (k && !`${r.actor_name ?? ''} ${r.action} ${r.summary ?? ''}`.toLowerCase().includes(k)) return false
      return true
    })
  }, [rows, keyword, categoryFilter, locationFilter, fromDate, toDate])

  function resetFilters() {
    setKeyword('')
    setCategoryFilter('')
    setLocationFilter('')
    setFromDate('')
    setToDate('')
  }

  function handleExport() {
    exportToExcel<ActivityRow>('操作紀錄', '操作紀錄', [
      { header: '時間', value: (r) => new Date(r.occurred_at).toLocaleDateString('zh-TW') },
      { header: '操作人', value: (r) => r.actor_name ?? '' },
      { header: '角色', value: (r) => roleDisplayName(r.actor_role ?? undefined) },
      { header: '分類', value: (r) => r.category },
      { header: '動作', value: (r) => r.action },
      { header: '說明', value: (r) => r.summary ?? '' },
      { header: '據點', value: (r) => locationName(r.location_id) },
    ], filtered)
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="mb-0"><i className="bi bi-clipboard-data" /> 操作紀錄</h2>
        <button className="btn btn-outline-success" onClick={handleExport} disabled={filtered.length === 0}>
          <i className="bi bi-file-earmark-excel" /> 匯出 Excel
        </button>
      </div>

      <div className="card shadow-sm mb-3">
        <div className="card-header bg-light"><i className="bi bi-funnel" /> 篩選條件</div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">關鍵字</label>
              <input className="form-control" placeholder="搜尋操作人、動作或說明" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="col-md-3">
              <label className="form-label">分類</label>
              <select className="form-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="">全部分類</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">據點</label>
              <select className="form-select" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                <option value="">全部據點</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.location_name}</option>)}
              </select>
            </div>
            <div className="col-md-2 d-flex align-items-end">
              <button type="button" className="btn btn-secondary w-100" onClick={resetFilters}><i className="bi bi-arrow-clockwise" /> 重設</button>
            </div>
            <div className="col-12">
              <label className="form-label">操作日期區間</label>
              <DateRangeFilter from={fromDate} to={toDate} onFrom={setFromDate} onTo={setToDate} />
            </div>
          </div>
        </div>
      </div>

      <div className="card shadow-sm">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th className="col-min">時間</th>
                <th className="col-min">操作人</th>
                <th className="col-min">分類</th>
                <th className="col-min">動作</th>
                <th>說明</th>
                <th className="col-min">據點</th>
                <th className="col-min" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center text-muted py-4">載入中…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-muted py-4">沒有符合條件的紀錄</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id}>
                  <td className="col-min text-nowrap">{new Date(r.occurred_at).toLocaleDateString('zh-TW')}</td>
                  <td className="col-min">
                    {r.actor_name ?? '—'}
                    {r.actor_role && <span className="badge bg-light text-dark ms-1">{roleDisplayName(r.actor_role)}</span>}
                  </td>
                  <td className="col-min"><span className={`badge ${categoryBadge[r.category] ?? 'bg-secondary'}`}>{r.category}</span></td>
                  <td className="col-min text-muted small">{r.action}</td>
                  <td>{r.summary ?? '—'}</td>
                  <td className="col-min">{locationName(r.location_id)}</td>
                  <td className="col-min">
                    {r.detail != null && (
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => setDetailRow(r)} title="查看細節">
                        <i className="bi bi-info-circle" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body py-2"><span className="text-muted small">共 {filtered.length} 筆</span></div>
      </div>

      {detailRow && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title"><i className="bi bi-info-circle" /> 操作細節</h5>
                <button type="button" className="btn-close" onClick={() => setDetailRow(null)} />
              </div>
              <div className="modal-body">
                <dl className="row mb-0">
                  <dt className="col-4">時間</dt><dd className="col-8">{new Date(detailRow.occurred_at).toLocaleDateString('zh-TW')}</dd>
                  <dt className="col-4">操作人</dt><dd className="col-8">{detailRow.actor_name ?? '—'}（{roleDisplayName(detailRow.actor_role ?? undefined)}）</dd>
                  <dt className="col-4">動作</dt><dd className="col-8">{detailRow.action}（{detailRow.category}）</dd>
                  <dt className="col-4">說明</dt><dd className="col-8">{detailRow.summary ?? '—'}</dd>
                  <dt className="col-4">受影響</dt><dd className="col-8">{detailRow.target_table ?? '—'}{detailRow.target_id ? ` #${detailRow.target_id}` : ''}</dd>
                </dl>
                <hr />
                <pre className="small bg-light p-2 rounded" style={{ maxHeight: 240, overflow: 'auto' }}>{JSON.stringify(detailRow.detail, null, 2)}</pre>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDetailRow(null)}>關閉</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
