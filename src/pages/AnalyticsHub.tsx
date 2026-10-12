// 分析中心（第一版）：總覽數字 + 自選「資料來源 / 分組維度 / 圖表」+ 匯出。
// 全部在前端彙總，圖表用 CSS 長條與 SVG 圓餅（不加相依、GitHub Pages 相容）。
// 僅總管。之後可再擴充維度、圖表類型與交叉分析。
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { exportToExcel } from '../lib/excelExport'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { withinRange } from '../lib/dateRange'
import type { SupplyLocation } from '../types/db'

type Rec = { time: string; qty: number; locationId: number | null; itemId: number | null; identity: string | null; district: string | null; reason: string | null; donor: string | null }
type SourceKey = 'outbound' | 'stockin' | 'donation' | 'disposal' | 'transfer'
type Dim = 'location' | 'item' | 'category' | 'identity' | 'district' | 'reason' | 'month'

const SOURCES: { key: SourceKey; label: string }[] = [
  { key: 'outbound', label: '領用' },
  { key: 'stockin', label: '入庫' },
  { key: 'donation', label: '捐贈' },
  { key: 'disposal', label: '報廢' },
  { key: 'transfer', label: '轉移' },
]
const DIM_LABEL: Record<Dim, string> = { location: '據點', item: '物資名稱', category: '物資種類', identity: '身分別', district: '鄉鎮', reason: '報廢原因', month: '月份' }
// 各來源可用的分組維度
const DIMS_FOR: Record<SourceKey, Dim[]> = {
  outbound: ['location', 'item', 'category', 'identity', 'district', 'month'],
  stockin: ['location', 'item', 'category', 'month'],
  donation: ['location', 'item', 'category', 'month'],
  disposal: ['location', 'item', 'category', 'reason', 'month'],
  transfer: ['location', 'item', 'category', 'month'],
}
const PALETTE = ['#4FC3F7', '#F58787', '#FBC02D', '#A8E6CF', '#B39DDB', '#FFB74D', '#4DB6AC', '#F06292', '#90A4AE', '#AED581']

export function AnalyticsHub() {
  const [data, setData] = useState<Record<SourceKey, Rec[]>>({ outbound: [], stockin: [], donation: [], disposal: [], transfer: [] })
  const [itemName, setItemName] = useState<Map<number, string>>(new Map())
  const [itemCat, setItemCat] = useState<Map<number, string>>(new Map())
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [loading, setLoading] = useState(true)

  const [source, setSource] = useState<SourceKey>('outbound')
  const [dim, setDim] = useState<Dim>('location')
  const [chart, setChart] = useState<'bar' | 'pie' | 'table'>('bar')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [outR, inR, disR, trfR, itemR, locR] = await Promise.all([
        supabase.from('supply_outbound_log').select('supply_item_id, outbound_quantity, outbound_time, location_id, recipient_identity, recipient_district, is_cancelled').limit(5000),
        supabase.from('supply_stock_in_log').select('supply_item_id, stock_in_quantity, stock_in_time, location_id, donor_name').limit(5000),
        supabase.from('supply_disposal_log').select('supply_item_id, disposal_quantity, disposal_time, location_id, reason').limit(5000),
        supabase.from('supply_transfer_log').select('supply_item_id, transfer_quantity, transfer_time, to_location_id, status').limit(5000),
        supabase.from('supply_item').select('id, item_name, category'),
        supabase.from('supply_location').select('*'),
      ])
      const nm = new Map<number, string>(); const cm = new Map<number, string>()
      for (const it of (itemR.data ?? []) as { id: number; item_name: string; category: string }[]) { nm.set(it.id, it.item_name); cm.set(it.id, it.category) }
      const mk = (o: Partial<Rec>): Rec => ({ time: o.time!, qty: o.qty ?? 0, locationId: o.locationId ?? null, itemId: o.itemId ?? null, identity: o.identity ?? null, district: o.district ?? null, reason: o.reason ?? null, donor: o.donor ?? null })
      const outbound = ((outR.data ?? []) as Record<string, unknown>[]).filter((r) => r.is_cancelled !== true).map((r) => mk({ time: r.outbound_time as string, qty: r.outbound_quantity as number, locationId: r.location_id as number, itemId: r.supply_item_id as number, identity: (r.recipient_identity as string) ?? null, district: (r.recipient_district as string) ?? null }))
      const stockin = ((inR.data ?? []) as Record<string, unknown>[]).map((r) => mk({ time: r.stock_in_time as string, qty: r.stock_in_quantity as number, locationId: r.location_id as number, itemId: r.supply_item_id as number, donor: (r.donor_name as string) ?? null }))
      const donation = stockin.filter((r) => r.donor && r.donor.trim())
      const disposal = ((disR.data ?? []) as Record<string, unknown>[]).map((r) => mk({ time: r.disposal_time as string, qty: r.disposal_quantity as number, locationId: r.location_id as number, itemId: r.supply_item_id as number, reason: (r.reason as string) ?? null }))
      const transfer = ((trfR.data ?? []) as Record<string, unknown>[]).map((r) => mk({ time: r.transfer_time as string, qty: r.transfer_quantity as number, locationId: r.to_location_id as number, itemId: r.supply_item_id as number }))
      setData({ outbound, stockin, donation, disposal, transfer })
      setItemName(nm); setItemCat(cm)
      setLocations((locR.data ?? []) as SupplyLocation[])
      setLoading(false)
    }
    void load()
  }, [])

  function locName(id: number | null) { return id == null ? '—' : locations.find((l) => l.id === id)?.location_name ?? `#${id}` }
  function dimValue(r: Rec, d: Dim): string {
    switch (d) {
      case 'location': return locName(r.locationId)
      case 'item': return r.itemId != null ? itemName.get(r.itemId) ?? `#${r.itemId}` : '—'
      case 'category': return r.itemId != null ? itemCat.get(r.itemId) ?? '—' : '—'
      case 'identity': return r.identity ?? '未填'
      case 'district': return r.district ?? '未填'
      case 'reason': return r.reason ?? '—'
      case 'month': return (r.time ?? '').slice(0, 7)
    }
  }

  // 目前來源、日期區間過濾後的紀錄
  const records = useMemo(() => data[source].filter((r) => withinRange(r.time, fromDate, toDate)), [data, source, fromDate, toDate])

  // 依維度彙總
  const rows = useMemo(() => {
    const m = new Map<string, { label: string; qty: number; count: number }>()
    for (const r of records) {
      const label = dimValue(r, dim)
      const g = m.get(label) ?? { label, qty: 0, count: 0 }
      g.qty += r.qty; g.count += 1
      m.set(label, g)
    }
    return [...m.values()].sort((a, b) => b.qty - a.qty)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, dim, itemName, itemCat, locations])

  const totalQty = rows.reduce((s, r) => s + r.qty, 0)
  const maxQty = Math.max(1, ...rows.map((r) => r.qty))

  // 總覽：各來源在日期區間內的總量
  const overview = useMemo(() => SOURCES.map((s) => ({
    label: s.label,
    qty: data[s.key].filter((r) => withinRange(r.time, fromDate, toDate)).reduce((a, r) => a + r.qty, 0),
  })), [data, fromDate, toDate])

  function handleExport() {
    exportToExcel<{ label: string; qty: number; count: number }>(`分析_${SOURCES.find((s) => s.key === source)?.label}_${DIM_LABEL[dim]}`, '分析', [
      { header: DIM_LABEL[dim], value: (r) => r.label },
      { header: '數量', value: (r) => r.qty, total: true },
      { header: '筆數', value: (r) => r.count, total: true },
    ], rows)
  }

  // 當來源變更時，若目前維度不適用就切回第一個可用維度
  useEffect(() => { if (!DIMS_FOR[source].includes(dim)) setDim(DIMS_FOR[source][0]) }, [source, dim])

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="mb-0"><i className="bi bi-bar-chart-line" /> 分析中心</h2>
        <button className="btn btn-outline-success" onClick={handleExport} disabled={rows.length === 0}>
          <i className="bi bi-file-earmark-excel" /> 匯出目前分析
        </button>
      </div>

      {/* 總覽 */}
      <div className="row g-3 mb-3">
        {overview.map((o, i) => (
          <div className="col" key={o.label}>
            <div className="card shadow-sm border-0 h-100" style={{ backgroundColor: PALETTE[i % PALETTE.length] }}>
              <div className="card-body py-2">
                <div className="small">{o.label}總量</div>
                <h4 className="mb-0">{o.qty}</h4>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 條件 */}
      <div className="card shadow-sm mb-3"><div className="card-header bg-light"><i className="bi bi-sliders" /> 分析設定（自由選擇）</div>
        <div className="card-body"><div className="row g-3">
          <div className="col-md-3">
            <label className="form-label">資料來源</label>
            <select className="form-select" value={source} onChange={(e) => setSource(e.target.value as SourceKey)}>
              {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label">分組維度</label>
            <select className="form-select" value={dim} onChange={(e) => setDim(e.target.value as Dim)}>
              {DIMS_FOR[source].map((d) => <option key={d} value={d}>{DIM_LABEL[d]}</option>)}
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label">呈現方式</label>
            <select className="form-select" value={chart} onChange={(e) => setChart(e.target.value as 'bar' | 'pie' | 'table')}>
              <option value="bar">長條圖</option>
              <option value="pie">圓餅圖</option>
              <option value="table">表格</option>
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label">日期區間</label>
            <DateRangeFilter from={fromDate} to={toDate} onFrom={setFromDate} onTo={setToDate} />
          </div>
        </div></div>
      </div>

      {/* 結果 */}
      <div className="card shadow-sm"><div className="card-body">
        {loading ? <p className="text-muted mb-0">載入中…</p> : rows.length === 0 ? <p className="text-muted mb-0">此條件下沒有資料</p> : (
          <>
            <h6 className="mb-3">{SOURCES.find((s) => s.key === source)?.label} × 依{DIM_LABEL[dim]}（總量 {totalQty}）</h6>
            {chart === 'pie' ? (
              <div className="d-flex flex-wrap align-items-center gap-4">
                <Pie rows={rows} total={totalQty} />
                <ul className="list-unstyled mb-0">
                  {rows.slice(0, 10).map((r, i) => (
                    <li key={r.label} className="d-flex align-items-center mb-1">
                      <span style={{ width: 12, height: 12, backgroundColor: PALETTE[i % PALETTE.length], display: 'inline-block', borderRadius: 2 }} className="me-2" />
                      {r.label}：<strong className="ms-1">{r.qty}</strong>（{totalQty ? Math.round((r.qty / totalQty) * 100) : 0}%）
                    </li>
                  ))}
                </ul>
              </div>
            ) : chart === 'bar' ? (
              <div>
                {rows.slice(0, 20).map((r, i) => (
                  <div key={r.label} className="mb-2">
                    <div className="d-flex justify-content-between small"><span>{r.label}</span><span className="text-muted">{r.qty}（{r.count} 筆）</span></div>
                    <div style={{ background: '#eee', borderRadius: 4, height: 18 }}>
                      <div style={{ width: `${(r.qty / maxQty) * 100}%`, backgroundColor: PALETTE[i % PALETTE.length], height: 18, borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="table-responsive mt-3">
              <table className="table table-sm table-hover mb-0">
                <thead className="table-light"><tr><th>{DIM_LABEL[dim]}</th><th className="text-end">數量</th><th className="text-end">筆數</th><th className="text-end">占比</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label}><td>{r.label}</td><td className="text-end">{r.qty}</td><td className="text-end">{r.count}</td><td className="text-end">{totalQty ? Math.round((r.qty / totalQty) * 100) : 0}%</td></tr>
                  ))}
                  <tr className="table-light fw-bold"><td>總計</td><td className="text-end">{totalQty}</td><td className="text-end">{rows.reduce((s, r) => s + r.count, 0)}</td><td className="text-end">100%</td></tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div></div>
    </div>
  )
}

// 簡易 SVG 圓餅（前 10 大 + 其他）
function Pie({ rows, total }: { rows: { label: string; qty: number }[]; total: number }) {
  const top = rows.slice(0, 10)
  const rest = rows.slice(10).reduce((s, r) => s + r.qty, 0)
  const slices = rest > 0 ? [...top, { label: '其他', qty: rest }] : top
  let acc = 0
  const R = 90, C = 100
  function pt(frac: number) { const a = 2 * Math.PI * frac - Math.PI / 2; return [C + R * Math.cos(a), C + R * Math.sin(a)] }
  return (
    <svg width={200} height={200} viewBox="0 0 200 200">
      {total === 0 ? <circle cx={C} cy={C} r={R} fill="#eee" /> : slices.map((s, i) => {
        const frac = s.qty / total
        const [x1, y1] = pt(acc); const [x2, y2] = pt(acc + frac)
        const large = frac > 0.5 ? 1 : 0
        const d = `M${C},${C} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} Z`
        acc += frac
        return <path key={i} d={d} fill={PALETTE[i % PALETTE.length]} />
      })}
    </svg>
  )
}
