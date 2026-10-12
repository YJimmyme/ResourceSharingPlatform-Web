// Port of DashboardController + DashboardService + Views/Dashboard/Index.cshtml.
// All aggregates read from the shared views (supply_item_resolved,
// location_low_stock_view, global_low_stock_view) instead of duplicating the
// resolution logic here — see migration plan §一.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { locationColorStyle } from '../lib/colors'
import { statusColorMap, statusCardStyle, AllDashboardStatuses, type DashboardStatusKey } from '../lib/statusColors'
import { FlashMessage } from '../components/FlashMessage'
import { useAuth } from '../hooks/useAuth'
import { Roles } from '../lib/enums'
import { functionErrorMessage } from '../lib/functionError'
import { logActivity } from '../lib/activityLog'
import type { SupplyLocation, SupplyRequest } from '../types/db'

// 物資總覽全域彙總（分工單 #2/#3）：改讀 dashboard_location_status /
// dashboard_summary（SECURITY DEFINER、只回統計數字），讓全部角色看到一致的
// 全部據點狀態，不再受「非總管只看自己據點」的 RLS 影響。
interface LocationStatusRow {
  location_id: number
  location_name: string
  is_active: boolean
  item_type_count: number
  total_quantity: number
  low_stock_count: number
  expiring_soon_count: number
  expired_count: number
}

interface SummaryRow {
  low_stock_total: number
  expiring_total: number
  expired_total: number
  global_low_total: number
}

interface LocationSummary {
  locationId: number
  locationName: string
  itemTypeCount: number
  totalQuantity: number
  lowStockCount: number
  expiringSoonCount: number
  expiredCount: number
}

export function Dashboard() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const isAdminOrCadre = isAdmin || profile?.role_name === Roles.Cadre
  const isSocialWorker = profile?.role_name === Roles.SocialWorker
  const myLoc = profile?.location_id ?? null
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [lowStockItemCount, setLowStockItemCount] = useState(0)
  const [globalLowStockCount, setGlobalLowStockCount] = useState(0)
  const [expiringSoonCount, setExpiringSoonCount] = useState(0)
  const [expiredCount, setExpiredCount] = useState(0)
  const [locationSummaries, setLocationSummaries] = useState<LocationSummary[]>([])
  const [requests, setRequests] = useState<SupplyRequest[]>([])
  const [detailReq, setDetailReq] = useState<SupplyRequest | null>(null) // 待處理需求「詳細」彈窗（看原因/備註）
  const [loading, setLoading] = useState(true)

  async function load() {
      setLoading(true)

      const [statusRes, summaryRes, locRes, reqRes] = await Promise.all([
        supabase.from('dashboard_location_status').select('*').order('location_id'),
        supabase.from('dashboard_summary').select('*').maybeSingle(),
        supabase.from('supply_location').select('*'),
        supabase.from('supply_request').select('*').eq('status', 'Open').order('created_at', { ascending: false }),
      ])

      const statusRows = (statusRes.data ?? []) as LocationStatusRow[]
      const summary = (summaryRes.data ?? null) as SummaryRow | null

      setLocations((locRes.data ?? []) as SupplyLocation[])
      setLowStockItemCount(summary?.low_stock_total ?? 0)
      setGlobalLowStockCount(summary?.global_low_total ?? 0)
      setExpiringSoonCount(summary?.expiring_total ?? 0)
      setExpiredCount(summary?.expired_total ?? 0)
      setRequests((reqRes.data ?? []) as SupplyRequest[])

      // 各據點統計：只列使用中的據點，數字全域一致（不受角色 RLS 影響）。
      setLocationSummaries(
        statusRows
          .filter((r) => r.is_active)
          .map((r) => ({
            locationId: r.location_id,
            locationName: r.location_name,
            itemTypeCount: r.item_type_count,
            totalQuantity: r.total_quantity,
            lowStockCount: r.low_stock_count,
            expiringSoonCount: r.expiring_soon_count,
            expiredCount: r.expired_count,
          }))
      )

      setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  async function markRequest(id: number, status: 'Fulfilled' | 'Cancelled') {
    await supabase.from('supply_request').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    void logActivity({ action: status === 'Fulfilled' ? 'request_fulfill' : 'request_cancel', category: '申請', targetTable: 'supply_request', targetId: id, summary: `需求 #${id} 標記為${status === 'Fulfilled' ? '完成' : '取消/駁回'}` })
    void load()
  }

  // 總管核准「報廢申請」：實際執行報廢（走 disposal-create），成功後把申請標記完成。
  async function approveDisposal(r: SupplyRequest) {
    if (!r.supply_item_id) return
    if (!confirm(`核准並報廢「${r.item_name}」${r.quantity} 件（已過期）？此動作會扣除庫存。`)) return
    const { data, error } = await supabase.functions.invoke('disposal-create', {
      body: {
        supplyItemId: r.supply_item_id,
        locationId: r.requesting_location_id,
        disposalQuantity: r.quantity,
        reason: 'Expired',
        remark: `核准幫主報廢申請（${r.requested_by ?? ''}）`,
      },
    })
    if (error || !data?.success) {
      alert(data?.message ?? (await functionErrorMessage(error, '報廢失敗')))
      return
    }
    void logActivity({ action: 'request_approve_disposal', category: '庫存異動', targetTable: 'supply_item', targetId: r.supply_item_id, locationId: r.requesting_location_id, summary: `核准報廢「${r.item_name}」${r.quantity} 件（已過期）` })
    await markRequest(r.id, 'Fulfilled')
  }

  function locationName(id: number): string {
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  if (loading) {
    return (
      <div className="d-flex justify-content-center py-5">
        <div className="spinner-border text-primary" role="status" />
      </div>
    )
  }

  // 待處理需求：總管看全部，其他單位（幫主）只看自己據點提出的。
  const visibleRequests = isAdmin ? requests : requests.filter((r) => r.requesting_location_id === myLoc)
  // 非總管的「已過期」卡片只計自己據點（清單也只顯示自己據點）。
  const mySummary = locationSummaries.find((s) => s.locationId === myLoc)

  return (
    <div className="container-fluid mt-4">
      <h2 className="mb-4">
        <i className="bi bi-speedometer2" /> 物資總覽
      </h2>
      <FlashMessage />

      {/* p.9 色塊改色：四種狀態統一配色（藍/紅/黃/鐵灰），共用 lib/statusColors */}
      <div className="row g-3 mb-4">
        {/* 小幫手：最左邊放「據點總物資」（馬卡龍綠，只看自己所屬據點），並移除總量不足卡 */}
        {isSocialWorker && (() => {
          const mine = locationSummaries.find((s) => s.locationId === myLoc)
          return (
            <div className="col-md-3" key="locationTotal">
              <Link to={`/supply-items?locationId=${myLoc ?? ''}`} className="card shadow-sm border-0 h-100 text-decoration-none" style={{ backgroundColor: '#A8E6CF', color: '#1b5e20' }}>
                <div className="card-body">
                  <h6><i className="bi bi-box-seam" /> 據點總物資</h6>
                  <h2 className="mb-0">{mine?.totalQuantity ?? 0}</h2>
                  <small style={{ opacity: 0.85 }}>{mine?.locationName ?? '我的據點'}　點擊查看 →</small>
                </div>
              </Link>
            </div>
          )
        })()}
        {AllDashboardStatuses
          .filter((key) => !(isSocialWorker && key === 'globalLowStock'))
          .map((key) => {
            const c = statusColorMap[key]
            const count: Record<DashboardStatusKey, number> = {
              // 小幫手：四格一律只計自己據點；其餘角色維持全域彙總。
              locationLowStock: isSocialWorker ? (mySummary?.lowStockCount ?? 0) : lowStockItemCount,
              globalLowStock: globalLowStockCount,
              expiringSoon: isSocialWorker ? (mySummary?.expiringSoonCount ?? 0) : expiringSoonCount,
              // 已過期：總管全域；幫主/小幫手只計自己據點。
              expired: isAdmin ? expiredCount : (mySummary?.expiredCount ?? 0),
            }
            // 總量不足：總管導到「捐贈紀錄」（可募資＋舉手，Admin 專屬頁）；
            // 幫主沒有捐贈紀錄權限，仍導到狀態清單頁（那裡一樣能舉手）。
            const to = key === 'globalLowStock' && isAdmin ? '/donations' : `/status/${key}`
            return (
              <div className="col-md-3" key={key}>
                {/* p.2：色塊本身可點擊，跳到對應頁 */}
                <Link to={to} className="card shadow-sm border-0 h-100 text-decoration-none" style={statusCardStyle(key)}>
                  <div className="card-body">
                    <h6>
                      <i className={`bi ${c.icon}`} /> {c.label}
                    </h6>
                    <h2 className="mb-0">{count[key]}</h2>
                    <small style={{ opacity: 0.85 }}>點擊查看清單 →</small>
                  </div>
                </Link>
              </div>
            )
          })}
      </div>

      <div className="row mb-4">
        <div className="col-12">
          <div className="card shadow-sm">
            <div className="card-header bg-secondary text-white">
              <i className="bi bi-pin-map-fill" /> 各據點物資統計
            </div>
            <div className="card-body">
              {locationSummaries.length === 0 ? (
                <p className="text-muted mb-0">目前沒有據點資料</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-bordered table-hover">
                    <thead className="table-light">
                      <tr>
                        <th>據點名稱</th>
                        <th>狀態</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locationSummaries.map((location) => (
                        <tr key={location.locationId}>
                          <td>
                            <i className="bi bi-building" /> {location.locationName}
                          </td>
                          <td>
                            {/* p.10：狀態欄取代「低庫存項目」數字，有異常才顯示對應狀態，否則顯示正常。 */}
                            {location.lowStockCount === 0 && location.expiringSoonCount === 0 ? (
                              <span className="badge bg-success">正常</span>
                            ) : (
                              <div className="d-flex flex-wrap gap-1">
                                {location.lowStockCount > 0 && (
                                  <span className="badge" style={{ backgroundColor: statusColorMap.locationLowStock.bg, color: statusColorMap.locationLowStock.text }}>
                                    低庫存 {location.lowStockCount}
                                  </span>
                                )}
                                {location.expiringSoonCount > 0 && (
                                  <span className="badge" style={{ backgroundColor: statusColorMap.expiringSoon.bg, color: statusColorMap.expiringSoon.text }}>
                                    即將過期 {location.expiringSoonCount}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td>
                            {/* 查看物資：全角色可用；非總管開啟的是唯讀檢視。 */}
                            <Link to={`/supply-items?locationId=${location.locationId}`} className="btn btn-sm btn-primary">
                              <i className="bi bi-search" /> 查看物資
                            </Link>
                          </td>
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

      {/* 待處理缺料需求；小幫手不需看到（僅總管/幫主） */}
      {isAdminOrCadre && (
      <div className="row">
        <div className="col-12 mb-4">
          <div className="card shadow-sm">
            <div className="card-header" style={{ backgroundColor: statusColorMap.locationLowStock.bg, color: statusColorMap.locationLowStock.text }}>
              <i className="bi bi-hand-index-thumb" /> 待處理需求（{visibleRequests.length}）
            </div>
            <div className="card-body">
              {visibleRequests.length === 0 ? (
                <p className="text-muted mb-0">目前沒有待處理的缺料需求</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th className="col-min">提出時間</th>
                        <th>品項</th>
                        <th className="col-min">需求據點</th>
                        <th className="col-min">來源據點</th>
                        <th className="col-min">數量</th>
                        <th className="col-min">提出人</th>
                        <th className="col-min">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRequests.map((r) => {
                        const isDisposal = r.request_type === 'disposal'
                        return (
                        <tr key={r.id}>
                          <td className="col-min">{new Date(r.created_at).toLocaleDateString('zh-TW')}</td>
                          <td>
                            {isDisposal && <span className="badge bg-dark me-1">報廢申請</span>}
                            <strong>{r.item_name}</strong>
                            {r.specification ? <span className="text-muted">／{r.specification}</span> : null}
                            <span className="text-muted">（{r.category}）</span>
                          </td>
                          <td className="col-min">
                            <span className="badge" style={locationColorStyle(r.requesting_location_id)}>
                              {locationName(r.requesting_location_id)}
                            </span>
                          </td>
                          <td className="col-min">
                            {r.source_location_id ? (
                              <span className="badge" style={locationColorStyle(r.source_location_id)}>
                                {locationName(r.source_location_id)}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="col-min">{r.quantity}</td>
                          <td className="col-min">{r.requested_by}</td>
                          <td className="col-min">
                            <div className="d-flex gap-1">
                              <button className="btn btn-sm btn-outline-info" title="詳細資料（含原因/備註）" onClick={() => setDetailReq(r)}>
                                <i className="bi bi-eye" /> 詳細
                              </button>
                              {isDisposal ? (
                                isAdmin ? (
                                  <>
                                    <button className="btn btn-sm btn-dark" onClick={() => void approveDisposal(r)} title="核准並報廢">
                                      <i className="bi bi-trash3" /> 核准報廢
                                    </button>
                                    <button className="btn btn-sm btn-outline-secondary" onClick={() => void markRequest(r.id, 'Cancelled')}>駁回</button>
                                  </>
                                ) : (
                                  <span className="text-muted small">等待總管核准</span>
                                )
                              ) : (
                                <>
                                  {isAdminOrCadre && (
                                    <Link className="btn btn-sm btn-primary" to={`/transfers/create?requestId=${r.id}`} title="從來源據點轉移補貨">
                                      <i className="bi bi-arrow-left-right" /> 轉移補貨
                                    </Link>
                                  )}
                                  {isAdmin && (
                                    <>
                                      <button className="btn btn-sm btn-outline-success" onClick={() => void markRequest(r.id, 'Fulfilled')}>完成</button>
                                      <button className="btn btn-sm btn-outline-secondary" onClick={() => void markRequest(r.id, 'Cancelled')}>取消</button>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      )}

      {/* 待處理需求詳細（看幫主填寫的原因/備註） */}
      {detailReq && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-hand-index-thumb" /> 需求詳細
                  {detailReq.request_type === 'disposal' && <span className="badge bg-dark ms-2">報廢申請</span>}
                </h5>
                <button type="button" className="btn-close" onClick={() => setDetailReq(null)} />
              </div>
              <div className="modal-body">
                <dl className="row mb-0">
                  <dt className="col-4">品項</dt>
                  <dd className="col-8">
                    {detailReq.item_name}
                    {detailReq.specification ? `／${detailReq.specification}` : ''}（{detailReq.category}）
                  </dd>
                  <dt className="col-4">數量</dt>
                  <dd className="col-8">{detailReq.quantity}</dd>
                  <dt className="col-4">需求據點</dt>
                  <dd className="col-8">{locationName(detailReq.requesting_location_id)}</dd>
                  <dt className="col-4">來源據點</dt>
                  <dd className="col-8">{detailReq.source_location_id ? locationName(detailReq.source_location_id) : '—'}</dd>
                  <dt className="col-4">提出人</dt>
                  <dd className="col-8">{detailReq.requested_by ?? '—'}</dd>
                  <dt className="col-4">提出時間</dt>
                  <dd className="col-8">{new Date(detailReq.created_at).toLocaleDateString('zh-TW')}</dd>
                  <dt className="col-4">{detailReq.request_type === 'disposal' ? '報廢原因' : '原因／備註'}</dt>
                  <dd className="col-8">{detailReq.note?.trim() ? detailReq.note : <span className="text-muted">未填</span>}</dd>
                </dl>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDetailReq(null)}>關閉</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
