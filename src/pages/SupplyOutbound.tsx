// 物資領用（發放）— 改為「以使用人為主體的批次領用」：
//   步驟一 使用人資料（姓名／聯絡方式／所屬鄉鎮／身分別）
//   步驟二 發放據點（非管理人員鎖定自己的據點）
//   步驟三 領用清單（可重複開彈窗加入多項物資，各自輸入數量）
// 送出時整批走 outbound-create Edge Function → outbound_create_batch()，
// 全部物資在同一個資料庫交易裡扣庫存，其中一項不足就整批 rollback。
// Index 只是一個受 RLS 限縮的 SELECT。
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { useItemPicker } from '../hooks/useItemPicker'
import { functionErrorMessage } from '../lib/functionError'
import { logActivity } from '../lib/activityLog'
import { locationColorStyle } from '../lib/colors'
import { Roles } from '../lib/enums'
import {
  AllRecipientIdentities,
  recipientIdentityBadgeClass,
  recipientIdentityDisplayName,
} from '../lib/yunlinDistricts'
import { ExpiringItemsPanel } from '../components/StockBatchPicker'
import {
  DistrictPickerModal,
  OutboundCancelModal,
  OutboundItemPickerModal,
} from '../components/OutboundModals'
import { fetchExpiringItems, expiryAlert } from '../lib/stockBatch'
import { FlashMessage } from '../components/FlashMessage'
import { DateRangeFilter } from '../components/DateRangeFilter'
 import { withinRange } from '../lib/dateRange'
import { exportToExcel } from '../lib/excelExport'
import type { SupplyItem, SupplyLocation, SupplyOutboundLog } from '../types/db'

/** 批次清單的一列：一個庫存批次 + 這次要領的數量。 */
interface OutboundLine {
  item: SupplyItem
  quantity: number
}

interface RecipientBlock {
  key: number
  name: string
  contact: string
  precinct: string | null
  district: string | null
  identity: string
  lines: OutboundLine[]
}

let recipientKeySeq = 1
function blankRecipient(): RecipientBlock {
  return { key: recipientKeySeq++, name: '', contact: '', precinct: null, district: null, identity: '', lines: [] }
}

export function SupplyOutboundCreate() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [adminLocationId, setAdminLocationId] = useState<number | null>(profile?.location_id ?? null)
  const effectiveLocationId = isAdmin ? adminLocationId : profile?.location_id ?? null

  const [expiringItems, setExpiringItems] = useState<SupplyItem[]>([])
  const [pendingItemId, setPendingItemId] = useState<number | null>(null)

  // 一張單多位使用人，每位各自的物資清單。
  const [recipients, setRecipients] = useState<RecipientBlock[]>([blankRecipient()])
  const [itemModalFor, setItemModalFor] = useState<number | null>(null) // 正在為哪位使用人加物資（recipient.key）
  const [districtModalFor, setDistrictModalFor] = useState<number | null>(null)
  const [showConfirmModal, setShowConfirmModal] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const picker = useItemPicker(effectiveLocationId)
  const { items: pickerItems, loading: pickerLoading } = picker
  const operatorName = profile?.display_name ?? profile?.username ?? ''
  const expiryScope = useMemo(() => (isAdmin ? null : profile?.location_id ?? null), [isAdmin, profile?.location_id])

  useEffect(() => {
    supabase.from('supply_location').select('*').eq('is_active', true).order('id').then(({ data }) => setLocations((data ?? []) as SupplyLocation[]))
  }, [])
  useEffect(() => {
    void fetchExpiringItems(expiryScope).then(setExpiringItems)
  }, [expiryScope])

  // 同一批次跨「所有使用人」已加入的數量，都要從可領數量扣掉。
  const remainingOf = useCallback(
    (item: SupplyItem) => item.quantity - recipients.reduce((s, r) => s + (r.lines.find((l) => l.item.id === item.id)?.quantity ?? 0), 0),
    [recipients]
  )

  function patchRecipient(key: number, patch: Partial<RecipientBlock>) {
    setRecipients((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }
  function addRecipient() {
    setRecipients((prev) => [...prev, blankRecipient()])
  }
  function removeRecipient(key: number) {
    setRecipients((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)))
  }
  // 建立副本：複製這位的「領用清單」到新的一位（接在其後）。
  // 個資（姓名／電話／鄉鎮／身分別）一律重填（留空）。
  // 送出前先確認每一項物資剩餘庫存足以「再領一次」，不足則不建立並提示。
  function duplicateRecipient(key: number) {
    const src = recipients.find((r) => r.key === key)
    if (!src) return
    if (src.lines.length === 0) {
      alert('這位的領用清單是空的，沒有可複製的物資。')
      return
    }
    for (const l of src.lines) {
      const rem = remainingOf(l.item) // 已扣掉所有使用人（含這位）目前分配量後的剩餘可領量
      if (l.quantity > rem) {
        alert(`無法建立副本：「${l.item.item_name}」目前剩餘可領 ${rem} ${l.item.unit ?? ''}，不足以再領 ${l.quantity}。請調整數量後再試。`)
        return
      }
    }
    const copy: RecipientBlock = { ...blankRecipient(), lines: src.lines.map((l) => ({ item: l.item, quantity: l.quantity })) }
    setRecipients((prev) => {
      const idx = prev.findIndex((r) => r.key === key)
      const next = [...prev]
      next.splice(idx < 0 ? prev.length : idx + 1, 0, copy)
      return next
    })
    setNotice('已建立副本：已複製領用清單，請填寫新使用人的姓名、電話、所屬鄉鎮與身分別。')
  }

  // 加物資到某位使用人（同批次自動累加）。
  const addLineTo = useCallback((key: number, item: SupplyItem, quantity: number) => {
    setError(null)
    setRecipients((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r
        const idx = r.lines.findIndex((l) => l.item.id === item.id)
        if (idx < 0) return { ...r, lines: [...r.lines, { item, quantity }] }
        const lines = [...r.lines]
        lines[idx] = { item, quantity: lines[idx].quantity + quantity }
        return { ...r, lines }
      })
    )
    setItemModalFor(null)
  }, [])

  function updateLineQty(key: number, itemId: number, value: string) {
    const qty = Number(value)
    setRecipients((prev) => prev.map((r) => (r.key === key ? { ...r, lines: r.lines.map((l) => (l.item.id === itemId ? { ...l, quantity: qty } : l)) } : r)))
  }
  function removeLineFrom(key: number, itemId: number) {
    setRecipients((prev) => prev.map((r) => (r.key === key ? { ...r, lines: r.lines.filter((l) => l.item.id !== itemId) } : r)))
  }

  // 即期快選／物資總覽帶入：加到第一位使用人。
  const addToFirst = useCallback((item: SupplyItem, quantity: number) => {
    setError(null)
    setRecipients((prev) => {
      if (prev.length === 0) return prev
      const first = prev[0]
      const idx = first.lines.findIndex((l) => l.item.id === item.id)
      const lines = idx < 0 ? [...first.lines, { item, quantity }] : first.lines.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + quantity } : l))
      return [{ ...first, lines }, ...prev.slice(1)]
    })
  }, [])

  useEffect(() => {
    const qLocationId = searchParams.get('locationId')
    const qItemId = searchParams.get('supplyItemId')
    if (isAdmin && qLocationId) setAdminLocationId(Number(qLocationId))
    if (qItemId) setPendingItemId(Number(qItemId))
  }, [searchParams, isAdmin])

  useEffect(() => {
    if (pendingItemId == null) return
    const target = pickerItems.find((x) => x.id === pendingItemId)
    if (!target) return
    addToFirst(target, 1)
    setPendingItemId(null)
  }, [pendingItemId, pickerItems, addToFirst])

  function quickPick(item: SupplyItem) {
    setError(null)
    setNotice(null)
    if (item.location_id !== effectiveLocationId) {
      if (!isAdmin) {
        setError('這項物資不在您所屬的據點')
        return
      }
      if (recipients.some((r) => r.lines.length > 0)) {
        setError('一次領用只能發放同一個據點的物資；請先清空領用清單再切換據點')
        return
      }
      setAdminLocationId(item.location_id)
    }
    setPendingItemId(item.id)
  }

  function changeLocation(id: number | null) {
    setAdminLocationId(id)
    setError(null)
    if (recipients.some((r) => r.lines.length > 0)) {
      setRecipients((prev) => prev.map((r) => ({ ...r, lines: [] })))
      setNotice('已切換據點，原本的領用清單已清空')
    }
  }

  const grandTotalItems = recipients.reduce((s, r) => s + r.lines.length, 0)
  const grandTotalQty = recipients.reduce((s, r) => s + r.lines.reduce((a, l) => a + (Number.isFinite(l.quantity) ? l.quantity : 0), 0), 0)

  function validate(): string | null {
    if (!effectiveLocationId) return isAdmin ? '請選擇發放據點' : '您的帳號尚未指定所屬據點，無法領用'
    if (recipients.length === 0) return '請至少加入一位使用人'
    for (const r of recipients) {
      if (!r.name.trim()) return '每一位使用人都要填姓名'
      if (!r.district) return `「${r.name || '未命名'}」請選擇所屬鄉鎮`
      if (!r.identity) return `「${r.name || '未命名'}」請選擇身分別`
      if (r.lines.length === 0) return `「${r.name}」至少要加入一項物資`
      for (const l of r.lines) {
        if (!Number.isInteger(l.quantity) || l.quantity <= 0) return `「${r.name}」的「${l.item.item_name}」數量必須是大於 0 的整數`
      }
    }
    const byItem = new Map<number, { qty: number; item: SupplyItem }>()
    for (const r of recipients) for (const l of r.lines) {
      const cur = byItem.get(l.item.id) ?? { qty: 0, item: l.item }
      cur.qty += l.quantity
      byItem.set(l.item.id, cur)
    }
    for (const { qty, item } of byItem.values()) {
      if (qty > item.quantity) return `「${item.item_name}」全部使用人合計 ${qty} 超過現有庫存（${item.quantity} ${item.unit ?? ''}）`
    }
    return null
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setShowConfirmModal(true)
  }

  async function doSubmit() {
    const problem = validate()
    if (problem) {
      setShowConfirmModal(false)
      setError(problem)
      return
    }
    setSubmitting(true)
    const { data, error: invokeError } = await supabase.functions.invoke('outbound-create', {
      body: {
        locationId: effectiveLocationId,
        recipients: recipients.map((r) => ({
          name: r.name.trim(),
          contact: r.contact.trim(),
          precinct: r.precinct,
          district: r.district,
          identity: r.identity,
          items: r.lines.map((l) => ({ supplyItemId: l.item.id, quantity: l.quantity })),
        })),
        remark: '',
      },
    })
    setSubmitting(false)
    if (invokeError || !data?.success) {
      setShowConfirmModal(false)
      setError(data?.message ?? (await functionErrorMessage(invokeError, '領用失敗')))
      return
    }
    const totalQty = recipients.reduce((s, r) => s + r.lines.reduce((t, l) => t + l.quantity, 0), 0)
    void logActivity({ action: 'outbound', category: '庫存異動', targetTable: 'supply_outbound_log', locationId: effectiveLocationId ?? null, summary: `領用發放（${recipients.length} 位使用人、共 ${totalQty} 件）`, detail: { recipients: recipients.map((r) => ({ name: r.name.trim(), items: r.lines.map((l) => ({ name: l.item.item_name, quantity: l.quantity })) })) } })
    navigate('/outbound', { state: { flash: data.message } })
  }

  const locName = (id: number | null) => locations.find((l) => l.id === id)?.location_name ?? ''

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="mb-0">
          <i className="bi bi-box-arrow-up" /> 物資領用（發放）
        </h2>
        <Link className="btn btn-outline-secondary" to="/outbound">
          <i className="bi bi-list-ul" /> 領用紀錄
        </Link>
      </div>
      <hr />

      <ExpiringItemsPanel items={expiringItems} locations={locations} title="即期／已過期物資，建議優先領用" actionLabel="加入第一位清單" onPick={quickPick} defaultCollapsed />

      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-info">{notice}</div>}

      <div className="row g-4">
        <div className="col-lg-8">
          <form onSubmit={handleSubmit}>
            {/* 發放據點（整張單共用） */}
            <div className="card shadow-sm mb-4">
              <div className="card-header bg-light">
                <i className="bi bi-geo" /> 發放據點
              </div>
              <div className="card-body">
                {isAdmin ? (
                  <select className="form-select" required value={adminLocationId ?? ''} onChange={(e) => changeLocation(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">請選擇據點</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>{l.location_name}</option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input className="form-control" disabled value={locName(effectiveLocationId)} />
                    <div className="form-text">只有最高權限管理人員可切換據點；您的帳號只能發放所屬據點的物資。</div>
                  </>
                )}
              </div>
            </div>

            {/* 使用人（可多位） */}
            {recipients.map((r, ri) => {
              const rTotalQty = r.lines.reduce((a, l) => a + (Number.isFinite(l.quantity) ? l.quantity : 0), 0)
              return (
                <div className="card shadow-sm mb-4 border-primary" key={r.key}>
                  <div className="card-header bg-primary-subtle text-dark d-flex justify-content-between align-items-center">
                    <span>
                      <i className="bi bi-person-vcard" /> 使用人 {ri + 1}
                    </span>
                    <div className="d-flex gap-2">
                      <button type="button" className="btn btn-sm btn-outline-primary" title="複製這位的領用清單到新的一位（姓名／電話／鄉鎮／身分別需重填）" onClick={() => duplicateRecipient(r.key)}>
                        <i className="bi bi-files" /> 建立副本
                      </button>
                      {recipients.length > 1 && (
                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removeRecipient(r.key)}>
                          <i className="bi bi-x-lg" /> 移除這位
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="card-body">
                    <div className="row">
                      <div className="col-md-6 mb-3">
                        <label className="form-label">使用人姓名 *</label>
                        <input className="form-control" maxLength={50} placeholder="例如：陳先生" value={r.name} onChange={(e) => patchRecipient(r.key, { name: e.target.value })} />
                      </div>
                      <div className="col-md-6 mb-3">
                        <label className="form-label">使用人電話</label>
                        <input className="form-control" maxLength={50} placeholder="例如：手機或地址" value={r.contact} onChange={(e) => patchRecipient(r.key, { contact: e.target.value })} />
                      </div>
                      <div className="col-md-6 mb-3">
                        <label className="form-label">所屬鄉鎮 *</label>
                        <div className="input-group">
                          <input className="form-control" readOnly placeholder="請點右側按鈕選擇" value={r.district ? `${r.precinct ?? ''}／${r.district}` : ''} />
                          <button type="button" className="btn btn-outline-primary" onClick={() => setDistrictModalFor(r.key)}>
                            <i className="bi bi-geo-alt" /> 選擇
                          </button>
                          {r.district && (
                            <button type="button" className="btn btn-outline-secondary" title="清除" onClick={() => patchRecipient(r.key, { precinct: null, district: null })}>
                              <i className="bi bi-x-lg" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="col-md-6 mb-3">
                        <label className="form-label d-block">身分別 *</label>
                        <div className="btn-group flex-wrap" role="group">
                          {AllRecipientIdentities.map((idv) => (
                            <button key={idv} type="button" className={`btn ${r.identity === idv ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => patchRecipient(r.key, { identity: idv })}>
                              {recipientIdentityDisplayName(idv)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <span className="fw-bold"><i className="bi bi-list-check" /> 領用清單</span>
                      <button type="button" className="btn btn-sm btn-primary" disabled={!effectiveLocationId} onClick={() => { setError(null); setItemModalFor(r.key) }}>
                        <i className="bi bi-plus-circle" /> 新增物資
                      </button>
                    </div>
                    <div className="table-responsive border rounded">
                      {/* table-layout:fixed 且不指定欄寬 → 每欄平均分配（5 欄各 20%）。 */}
                      <table className="table table-hover align-middle mb-0" style={{ tableLayout: 'fixed' }}>
                        <thead className="table-light">
                          <tr>
                            <th>物資</th>
                            <th>規格／批次</th>
                            <th>庫存</th>
                            <th>領用數量</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {r.lines.length === 0 ? (
                            <tr><td colSpan={5} className="text-center text-muted py-3">{effectiveLocationId ? '尚未加入物資，按右上「新增物資」' : '請先選擇發放據點'}</td></tr>
                          ) : (
                            r.lines.map((l) => {
                              const alert = expiryAlert(l.item)
                              // 這位使用人看到的庫存＝原始庫存扣掉「排在前面的使用人」已領的同批次數量，
                              // 讓第二位之後看到的是前面領完後的剩餘量。
                              const stockHere =
                                l.item.quantity -
                                recipients.slice(0, ri).reduce((s, rr) => s + (rr.lines.find((x) => x.item.id === l.item.id)?.quantity ?? 0), 0)
                              const over = l.quantity > stockHere
                              return (
                                <tr key={l.item.id}>
                                  <td style={{ wordBreak: 'break-word' }}><strong>{l.item.item_name}</strong><div className="text-muted small">{l.item.category}</div></td>
                                  <td style={{ wordBreak: 'break-word' }}>{l.item.specification?.trim() || '無'}{alert && <span className={`badge ms-1 ${alert.badgeClass}`}>{alert.label}</span>}</td>
                                  <td className="text-nowrap">{stockHere} {l.item.unit ?? ''}</td>
                                  <td>
                                    <input className={`form-control form-control-sm ${over ? 'is-invalid' : ''}`} type="number" min={1} max={stockHere} value={l.quantity} onChange={(e) => updateLineQty(r.key, l.item.id, e.target.value)} />
                                  </td>
                                  <td className="text-end"><button type="button" className="btn btn-sm btn-outline-danger" title="移除" onClick={() => removeLineFrom(r.key, l.item.id)}><i className="bi bi-trash" /></button></td>
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                        {r.lines.length > 0 && (
                          <tfoot className="table-light"><tr><td colSpan={5} className="text-end fw-bold text-nowrap">小計：{r.lines.length} 項／{rTotalQty} 件</td></tr></tfoot>
                        )}
                      </table>
                    </div>
                  </div>
                </div>
              )
            })}

            <div className="mb-4">
              <button type="button" className="btn btn-outline-primary" onClick={addRecipient}>
                <i className="bi bi-person-plus" /> 新增使用人
              </button>
            </div>

            {/* 備註 + 送出 */}
            <div className="card shadow-sm">
              <div className="card-body">
                <div className="mb-3">
                  <label className="form-label">操作人員</label>
                  <input className="form-control" disabled value={operatorName} />
                  <div className="form-text">系統會自動記錄目前登入帳號為操作人員。</div>
                </div>
                <div className="d-flex gap-2">
                  <button type="submit" className="btn btn-primary btn-lg" disabled={submitting || grandTotalItems === 0}>
                    <i className="bi bi-check-circle" /> 確認領用（{recipients.length} 位／{grandTotalItems} 項）
                  </button>
                  <Link className="btn btn-secondary btn-lg" to="/outbound">← 返回紀錄</Link>
                </div>
              </div>
            </div>
          </form>
        </div>

        <div className="col-lg-4">
          <div className="alert alert-info">
            <strong><i className="bi bi-info-circle" /> 領用說明</strong>
            <ul className="mb-0 mt-2">
              <li>一張單可加入多位使用人，每位各自填資料與物資清單</li>
              <li>按「新增使用人」再加一位，最後一次確認送出</li>
              <li>物資清單只顯示所屬據點的庫存；只有最高權限管理人員能切換據點</li>
              <li>全部使用人在同一個交易裡扣庫存，其中一項不足會整批取消</li>
            </ul>
          </div>
          <div className="alert alert-warning">
            <strong><i className="bi bi-exclamation-triangle" /> 注意事項</strong>
            <ul className="mb-0 mt-2">
              <li>請確認每一項的領用數量正確</li>
              <li>領用後可於「領用紀錄」修改（物資小天使限 5 個工作天內、自己上傳的）</li>
              <li>建議填寫聯絡方式以利後續追蹤</li>
            </ul>
          </div>
        </div>
      </div>

      {districtModalFor != null && (
        <DistrictPickerModal
          currentPrecinct={recipients.find((r) => r.key === districtModalFor)?.precinct ?? null}
          currentDistrict={recipients.find((r) => r.key === districtModalFor)?.district ?? null}
          onCancel={() => setDistrictModalFor(null)}
          onSelect={(precinct, district) => {
            patchRecipient(districtModalFor, { precinct, district })
            setDistrictModalFor(null)
          }}
        />
      )}

      {itemModalFor != null && (
        <OutboundItemPickerModal
          items={pickerItems}
          loading={pickerLoading}
          remainingOf={remainingOf}
          onCancel={() => setItemModalFor(null)}
          onAdd={(item, qty) => addLineTo(itemModalFor, item, qty)}
        />
      )}

      {showConfirmModal && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title"><i className="bi bi-clipboard-check" /> 確認本次領用內容</h5>
                <button type="button" className="btn-close" disabled={submitting} onClick={() => setShowConfirmModal(false)} />
              </div>
              <div className="modal-body">
                <div className="mb-2 small text-muted">發放據點：{locName(effectiveLocationId)}｜操作人員：{operatorName}</div>
                {recipients.map((r, ri) => (
                  <div className="card border mb-2" key={r.key}>
                    <div className="card-header bg-light py-2">
                      <strong>使用人 {ri + 1}：{r.name}</strong>
                      <span className="text-muted small ms-2">
                        {r.contact ? `${r.contact}／` : ''}{r.district ?? '—'}
                        <span className="ms-1"><span className={`badge ${recipientIdentityBadgeClass(r.identity)}`}>{recipientIdentityDisplayName(r.identity)}</span></span>
                      </span>
                    </div>
                    <table className="table table-sm mb-0">
                      <thead><tr><th>物資</th><th className="col-min">規格</th><th className="col-min text-end">領用</th><th className="col-min text-end">領用後剩餘</th></tr></thead>
                      <tbody>
                        {r.lines.map((l) => (
                          <tr key={l.item.id}>
                            <td>{l.item.item_name}<div className="text-muted small">{l.item.category}</div></td>
                            <td className="col-min">{l.item.specification?.trim() || '無'}</td>
                            <td className="col-min text-end"><strong>{l.quantity}</strong> {l.item.unit ?? ''}</td>
                            <td className="col-min text-end text-muted">{l.item.quantity - l.quantity} {l.item.unit ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                <div className="alert alert-warning mt-2 mb-0">
                  <i className="bi bi-exclamation-triangle" /> 合計 {recipients.length} 位使用人、{grandTotalItems} 項、{grandTotalQty} 件。按「確定領用」會<strong>立刻扣除庫存</strong>，請再確認一次。
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" disabled={submitting} onClick={() => setShowConfirmModal(false)}><i className="bi bi-pencil" /> 返回修改</button>
                <button type="button" className="btn btn-primary" disabled={submitting} onClick={() => void doSubmit()}><i className="bi bi-check-circle" /> {submitting ? '處理中…' : '確定領用'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function SupplyOutboundIndex() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const [logs, setLogs] = useState<SupplyOutboundLog[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [items, setItems] = useState<SupplyItem[]>([])
  const [keyword, setKeyword] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [identityFilter, setIdentityFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'cancelled'>('')
  const [itemFilter, setItemFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [loading, setLoading] = useState(true)
  // 取消領用
  const [cancelTarget, setCancelTarget] = useState<SupplyOutboundLog | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'danger'; text: string } | null>(null)
  // 查看詳情（整批領用單）
  const [detailTarget, setDetailTarget] = useState<SupplyOutboundLog | null>(null)
  // 修改領用
  const [editTarget, setEditTarget] = useState<SupplyOutboundLog | null>(null)
  const [editForm, setEditForm] = useState({ supplyItemId: 0, quantity: '', name: '', contact: '', precinct: null as string | null, district: null as string | null, identity: '', remark: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [showEditDistrict, setShowEditDistrict] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [logRes, locRes, itemRes] = await Promise.all([
      supabase.from('supply_outbound_log').select('*').order('outbound_time', { ascending: false }).limit(100),
      supabase.from('supply_location').select('*'),
      supabase.from('supply_item').select('id, item_name, category, specification, unit, quantity, location_id, is_active'),
    ])
    setLogs((logRes.data ?? []) as SupplyOutboundLog[])
    setLocations((locRes.data ?? []) as SupplyLocation[])
    setItems((itemRes.data ?? []) as SupplyItem[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function itemOf(id: number): SupplyItem | undefined {
    return items.find((i) => i.id === id)
  }

  // 物資品項篩選是按「品名」比對（不是 supply_item_id）—— 同一個品名底下可能有
  // 好幾個批次（不同規格／效期各一列），使用者想找的是「米」，不是「某一批米」。
  // 找不到對應資料時的 fallback 文字要跟下拉選項用同一份，否則會對不起來。
  function itemNameOf(id: number): string {
    return itemOf(id)?.item_name ?? `物資 #${id}`
  }

  // 下拉選項只列「目前這批紀錄裡真的出現過的品項」，並附上筆數，
  // 避免把整個物資目錄倒出來（大多數品項在這 100 筆裡根本沒出現）。
  const itemOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const l of logs) {
      const name = itemNameOf(l.supply_item_id)
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, items])

  // 取消權限比照 outbound-cancel Edge Function：管理員不限據點，
  // 其他角色只能取消自己據點發出去的。前端只是把按鈕藏起來，真正的把關在後端。
  function canCancel(log: SupplyOutboundLog): boolean {
    if (log.is_cancelled) return false
    return isAdmin || profile?.location_id === log.location_id
  }

  // 同一批次還有幾項（不含這一筆）—— 用來提醒使用者「只會取消這一項」。
  function sameBatchCount(log: SupplyOutboundLog): number {
    if (!log.batch_id) return 0
    return logs.filter((l) => l.batch_id === log.batch_id && l.id !== log.id && !l.is_cancelled).length
  }

  // 領用後經過幾個工作天（不含當天）。前端用來決定要不要顯示「編輯」按鈕；
  // 真正的把關在 outbound_edit RPC 內（總管不限、據點管理人員限所屬據點、物資小天使限自己且 5 工作天內）。
  function businessDaysSince(iso: string): number {
    const start = new Date(iso)
    start.setHours(0, 0, 0, 0)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    let n = 0
    const d = new Date(start)
    d.setDate(d.getDate() + 1)
    while (d <= today) {
      const w = d.getDay()
      if (w !== 0 && w !== 6) n++
      d.setDate(d.getDate() + 1)
    }
    return n
  }
  function canEdit(log: SupplyOutboundLog): boolean {
    if (log.is_cancelled) return false
    if (isAdmin) return true
    if (profile?.role_name === Roles.Cadre) return profile?.location_id === log.location_id
    // 物資小天使：自己上傳的、5 個工作天內
    const self = profile?.display_name ?? profile?.username ?? ''
    return log.operator === self && businessDaysSince(log.outbound_time) <= 5
  }

  function openEdit(log: SupplyOutboundLog) {
    setMessage(null)
    setEditTarget(log)
    setEditForm({
      supplyItemId: log.supply_item_id,
      quantity: String(log.outbound_quantity),
      name: log.recipient_name,
      contact: log.recipient_contact ?? '',
      precinct: log.recipient_precinct,
      district: log.recipient_district,
      identity: log.recipient_identity ?? '',
      remark: log.remark ?? '',
    })
  }

  async function submitEdit(e: FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    const qty = Number(editForm.quantity)
    if (!Number.isInteger(qty) || qty <= 0) {
      setMessage({ type: 'danger', text: '領用數量必須是大於 0 的整數' })
      return
    }
    if (!editForm.name.trim() || !editForm.district || !editForm.identity) {
      setMessage({ type: 'danger', text: '請填使用人姓名、所屬鄉鎮與身分別' })
      return
    }
    setEditSaving(true)
    const { error } = await supabase.rpc('outbound_edit', {
      p_log_id: editTarget.id,
      p_new_supply_item_id: editForm.supplyItemId,
      p_new_quantity: qty,
      p_recipient_name: editForm.name.trim(),
      p_recipient_contact: editForm.contact.trim() || null,
      p_recipient_precinct: editForm.precinct,
      p_recipient_district: editForm.district,
      p_recipient_identity: editForm.identity,
      p_remark: editForm.remark.trim() || null,
    })
    setEditSaving(false)
    if (error) {
      setMessage({ type: 'danger', text: error.message })
      return
    }
    void logActivity({ action: 'outbound_edit', category: '庫存異動', targetTable: 'supply_outbound_log', targetId: editTarget.id, locationId: editTarget.location_id, summary: `修改領用紀錄 #${editTarget.id}（使用人 ${editForm.name.trim()}、數量 ${qty}）` })
    setEditTarget(null)
    setMessage({ type: 'success', text: '領用紀錄已更新，庫存已回算' })
    await load()
  }

  // 同一批（同 batch_id）的所有品項；沒有 batch_id 就只有自己一筆。已取消的不列入單據。
  function batchOf(log: SupplyOutboundLog): SupplyOutboundLog[] {
    if (!log.batch_id) return [log]
    return logs.filter((l) => l.batch_id === log.batch_id && !l.is_cancelled)
  }

  // 列印「領用單／簽收單」：用隱藏 iframe 寫入乾淨 HTML 再列印（避開彈窗攔截與 App 樣式）。
  function printReceipt(log: SupplyOutboundLog) {
    const rows = batchOf(log)
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c]))
    const totalQty = rows.reduce((s, l) => s + l.outbound_quantity, 0)
    const itemRows = rows
      .map((l, i) => {
        const it = itemOf(l.supply_item_id)
        return `<tr><td>${i + 1}</td><td>${esc(it?.item_name ?? '物資 #' + l.supply_item_id)}</td><td>${esc(it?.specification ?? '無')}</td><td style="text-align:right">${l.outbound_quantity} ${esc(it?.unit ?? '')}</td></tr>`
      })
      .join('')
    const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>領用單</title>
<style>
*{font-family:"Microsoft JhengHei","PingFang TC","Heiti TC",sans-serif;box-sizing:border-box}
body{padding:24px;color:#000}
h1{text-align:center;font-size:22px;margin:0 0 4px}
.sub{text-align:center;color:#555;margin:0 0 16px;font-size:12px}
table{width:100%;border-collapse:collapse;margin:8px 0}
.meta td{padding:4px 6px;font-size:14px;vertical-align:top}
.items th,.items td{border:1px solid #333;padding:6px 8px;font-size:14px}
.items th{background:#f0f0f0}
.sign{margin-top:48px;display:flex;justify-content:space-between;font-size:14px}
.sign div{width:45%;border-top:1px solid #333;padding-top:6px;text-align:center;color:#333}
@media print{body{padding:0}}
</style></head><body>
<h1>愛心轉運站 · 物資領用單</h1>
<p class="sub">領用單號：${esc(log.batch_id ?? '#' + log.id)}　列印時間：${esc(new Date().toLocaleDateString('zh-TW'))}</p>
<table class="meta">
<tr><td width="15%"><b>領用時間</b></td><td width="35%">${esc(new Date(log.outbound_time).toLocaleDateString('zh-TW'))}</td><td width="15%"><b>發放據點</b></td><td>${esc(locationName(log.location_id))}</td></tr>
<tr><td><b>使用人</b></td><td>${esc(log.recipient_name)}</td><td><b>聯絡方式</b></td><td>${esc(log.recipient_contact ?? '')}</td></tr>
<tr><td><b>所屬鄉鎮</b></td><td>${esc((log.recipient_precinct ? log.recipient_precinct + ' / ' : '') + (log.recipient_district ?? ''))}</td><td><b>身分別</b></td><td>${esc(recipientIdentityDisplayName(log.recipient_identity))}</td></tr>
<tr><td><b>操作人員</b></td><td>${esc(log.operator ?? '')}</td><td><b>備註</b></td><td>${esc(log.remark ?? '')}</td></tr>
</table>
<table class="items"><thead><tr><th style="width:40px">#</th><th>物資</th><th style="width:130px">規格</th><th style="width:120px;text-align:right">數量</th></tr></thead>
<tbody>${itemRows}</tbody>
<tfoot><tr><th colspan="3" style="text-align:right">合計</th><th style="text-align:right">${rows.length} 項 / ${totalQty} 件</th></tr></tfoot></table>
<div class="sign"><div>使用人簽名</div><div>經辦人簽名</div></div>
</body></html>`
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
    document.body.appendChild(iframe)
    const doc = iframe.contentWindow?.document
    if (!doc) {
      document.body.removeChild(iframe)
      return
    }
    doc.open()
    doc.write(html)
    doc.close()
    setTimeout(() => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      setTimeout(() => document.body.removeChild(iframe), 1000)
    }, 300)
  }

  async function confirmCancel(reason: string) {
    if (!cancelTarget) return
    const target = cancelTarget
    setCancelling(true)
    const { data, error } = await supabase.functions.invoke('outbound-cancel', {
      body: { logId: target.id, reason },
    })
    setCancelling(false)
    setCancelTarget(null)
    if (error || !data?.success) {
      setMessage({ type: 'danger', text: data?.message ?? (await functionErrorMessage(error, '取消失敗')) })
      return
    }
    void logActivity({ action: 'outbound_cancel', category: '庫存異動', targetTable: 'supply_outbound_log', targetId: target.id, locationId: target.location_id, summary: `取消領用紀錄 #${target.id}（回庫）`, detail: { reason } })
    setMessage({ type: 'success', text: data.message })
    await load()
  }

  // 小幫手只看「自己上傳的」領用紀錄（個人領用紀錄）。
  const isSocialWorker = profile?.role_name === Roles.SocialWorker
  const selfName = profile?.display_name ?? profile?.username ?? ''

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (isSocialWorker && l.operator !== selfName) return false
      if (!withinRange(l.outbound_time, fromDate, toDate)) return false
      if (locationFilter && l.location_id !== Number(locationFilter)) return false
      if (identityFilter && l.recipient_identity !== identityFilter) return false
      if (itemFilter && itemNameOf(l.supply_item_id) !== itemFilter) return false
      if (statusFilter === 'active' && l.is_cancelled) return false
      if (statusFilter === 'cancelled' && !l.is_cancelled) return false
      if (keyword.trim()) {
        const k = keyword.trim().toLowerCase()
        const name = itemOf(l.supply_item_id)?.item_name ?? ''
        if (
          !l.recipient_name.toLowerCase().includes(k) &&
          !(l.recipient_contact ?? '').toLowerCase().includes(k) &&
          !(l.recipient_district ?? '').toLowerCase().includes(k) &&
          !(l.recipient_precinct ?? '').toLowerCase().includes(k) &&
          !(l.operator ?? '').toLowerCase().includes(k) &&
          !(l.remark ?? '').toLowerCase().includes(k) &&
          !name.toLowerCase().includes(k)
        )
          return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, keyword, locationFilter, identityFilter, itemFilter, statusFilter, fromDate, toDate, items, isSocialWorker, selfName])

  function locationName(id: number): string {
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  function handleExport() {
    exportToExcel<SupplyOutboundLog>('領用紀錄', '領用紀錄', [
      { header: '領用時間', value: (l) => new Date(l.outbound_time).toLocaleDateString('zh-TW') },
      { header: '物資名稱', value: (l) => itemOf(l.supply_item_id)?.item_name ?? `物資 #${l.supply_item_id}` },
      { header: '規格', value: (l) => itemOf(l.supply_item_id)?.specification ?? '' },
      { header: '來源據點', value: (l) => locationName(l.location_id) },
      { header: '領用數量', value: (l) => l.outbound_quantity, total: true },
      { header: '單位', value: (l) => itemOf(l.supply_item_id)?.unit ?? '' },
      { header: '使用人', value: (l) => l.recipient_name },
      { header: '聯絡方式', value: (l) => l.recipient_contact ?? '' },
      { header: '區', value: (l) => l.recipient_precinct ?? '' },
      { header: '所屬鄉鎮', value: (l) => l.recipient_district ?? '' },
      { header: '身分別', value: (l) => recipientIdentityDisplayName(l.recipient_identity) },
      { header: '操作人員', value: (l) => l.operator ?? '' },
      { header: '備註', value: (l) => l.remark ?? '' },
      { header: '狀態', value: (l) => (l.is_cancelled ? '已取消' : '已領用') },
      { header: '取消時間', value: (l) => (l.cancelled_at ? new Date(l.cancelled_at).toLocaleDateString('zh-TW') : '') },
      { header: '取消人員', value: (l) => l.cancelled_by ?? '' },
      { header: '取消原因', value: (l) => l.cancel_reason ?? '' },
    ], filtered)
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">
          <i className="bi bi-list-ul" /> {isSocialWorker ? '個人領用紀錄' : '物資領用紀錄'}
        </h2>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-success" onClick={handleExport} disabled={filtered.length === 0}>
            <i className="bi bi-file-earmark-excel" /> 匯出 Excel
          </button>
          {isAdmin && (
            <Link className="btn btn-outline-primary" to="/outbound/recipient-analysis">
              <i className="bi bi-graph-up" /> 查看領取分析
            </Link>
          )}
          <Link className="btn btn-primary" to="/outbound/create">
            <i className="bi bi-plus-circle" /> 新增領用
          </Link>
        </div>
      </div>
      <FlashMessage />
      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}
      <div className="card shadow-sm mb-3">
        <div className="card-header bg-light">
          <i className="bi bi-funnel" /> 篩選條件
        </div>
        <div className="card-body">
          {/* 六個欄位，md 以上排成兩列各三個（原本一列硬塞五個會擠爆並自己折行）。 */}
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">關鍵字</label>
              <input className="form-control" placeholder="搜尋使用人、聯絡方式、鄉鎮或物資" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="col-md-4">
              <label className="form-label">物資品項</label>
              <select className="form-select" value={itemFilter} onChange={(e) => setItemFilter(e.target.value)}>
                <option value="">全部物資品項</option>
                {itemOptions.map(([name, count]) => (
                  <option key={name} value={name}>
                    {name}（{count} 筆）
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">據點</label>
              <select className="form-select" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                <option value="">全部據點</option>
                {/* 篩選只列使用中的據點；已停用據點不再出現（歷史紀錄的名稱仍可解析）。 */}
                {locations.filter((l) => l.is_active !== false).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.location_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">身分別</label>
              <select className="form-select" value={identityFilter} onChange={(e) => setIdentityFilter(e.target.value)}>
                <option value="">全部身分別</option>
                {AllRecipientIdentities.map((idv) => (
                  <option key={idv} value={idv}>
                    {recipientIdentityDisplayName(idv)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">狀態</label>
              <select
                className="form-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as '' | 'active' | 'cancelled')}
              >
                <option value="">全部狀態</option>
                <option value="active">已領用</option>
                <option value="cancelled">已取消</option>
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">領用日期區間</label>
              <DateRangeFilter from={fromDate} to={toDate} onFrom={setFromDate} onTo={setToDate} />
            </div>
            <div className="col-md-4 d-flex align-items-end">
              <button
                type="button"
                className="btn btn-secondary w-100"
                onClick={() => {
                  setKeyword('')
                  setLocationFilter('')
                  setIdentityFilter('')
                  setItemFilter('')
                  setStatusFilter('')
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
                  <th className="col-min">領用時間</th>
                  <th>物資名稱</th>
                  <th className="col-min">來源據點</th>
                  <th className="col-min">領用數量</th>
                  <th>使用人</th>
                  <th>聯絡方式</th>
                  <th className="col-min">所屬鄉鎮</th>
                  <th className="col-min">身分別</th>
                  <th className="col-min">操作人員</th>
                  <th>備註</th>
                  <th className="col-min">狀態</th>
                  <th className="col-min">動作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={12} className="text-center text-muted py-4">
                      載入中…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="text-center text-muted py-4">
                      沒有符合條件的領用紀錄
                    </td>
                  </tr>
                ) : (
                  filtered.map((log) => (
                    // 已取消的整列淡化 + 刪除線，一眼看得出這筆不算數
                    <tr key={log.id} className={log.is_cancelled ? 'text-muted' : undefined}>
                      <td className="col-min">{new Date(log.outbound_time).toLocaleDateString('zh-TW')}</td>
                      <td>
                        <strong>{itemOf(log.supply_item_id)?.item_name ?? `物資 #${log.supply_item_id}`}</strong>
                        {itemOf(log.supply_item_id)?.specification ? (
                          <span className="text-muted"> ／{itemOf(log.supply_item_id)?.specification}</span>
                        ) : null}
                        {log.batch_id && (
                          <span className="badge bg-light text-dark border ms-1" title="同一次批次領用">
                            <i className="bi bi-collection" /> 批次
                          </span>
                        )}
                      </td>
                      <td className="col-min">
                        <span className="badge" style={locationColorStyle(log.location_id)}>
                          {locationName(log.location_id)}
                        </span>
                      </td>
                      <td className="col-min">
                        <span style={log.is_cancelled ? { textDecoration: 'line-through' } : undefined}>
                          <strong>{log.outbound_quantity}</strong> {itemOf(log.supply_item_id)?.unit ?? ''}
                        </span>
                      </td>
                      <td>{log.recipient_name}</td>
                      <td>{log.recipient_contact}</td>
                      <td className="col-min">
                        {log.recipient_district ?? ''}
                        {log.recipient_precinct && (
                          <div className="text-muted small">{log.recipient_precinct}</div>
                        )}
                      </td>
                      <td className="col-min">
                        {log.recipient_identity && (
                          <span className={`badge ${recipientIdentityBadgeClass(log.recipient_identity)}`}>
                            {recipientIdentityDisplayName(log.recipient_identity)}
                          </span>
                        )}
                      </td>
                      <td className="col-min">{log.operator}</td>
                      <td>{log.remark}</td>
                      <td className="col-min">
                        {log.is_cancelled ? (
                          <>
                            <span className="badge bg-secondary">已取消</span>
                            <div className="small">
                              {log.cancelled_by}
                              {log.cancelled_at && <br />}
                              {log.cancelled_at && new Date(log.cancelled_at).toLocaleDateString('zh-TW')}
                            </div>
                            {log.cancel_reason && <div className="small fst-italic">{log.cancel_reason}</div>}
                          </>
                        ) : (
                          <span className="badge bg-success">已領用</span>
                        )}
                      </td>
                      <td className="col-min text-nowrap">
                        <button type="button" className="btn btn-outline-secondary btn-sm me-1" title="查看整批詳情" onClick={() => setDetailTarget(log)}>
                          <i className="bi bi-eye" /> 詳情
                        </button>
                        {canEdit(log) && (
                          <button type="button" className="btn btn-outline-primary btn-sm me-1" onClick={() => openEdit(log)}>
                            <i className="bi bi-pencil" /> 編輯
                          </button>
                        )}
                        {canCancel(log) && (
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm"
                            onClick={() => {
                              setMessage(null)
                              setCancelTarget(log)
                            }}
                          >
                            <i className="bi bi-arrow-counterclockwise" /> 取消
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {cancelTarget && (
        <OutboundCancelModal
          itemLabel={
            itemOf(cancelTarget.supply_item_id)
              ? `${itemOf(cancelTarget.supply_item_id)?.item_name}${
                  itemOf(cancelTarget.supply_item_id)?.specification
                    ? `／${itemOf(cancelTarget.supply_item_id)?.specification}`
                    : ''
                }`
              : `物資 #${cancelTarget.supply_item_id}`
          }
          quantityLabel={`${cancelTarget.outbound_quantity} ${itemOf(cancelTarget.supply_item_id)?.unit ?? ''}`}
          recipientName={cancelTarget.recipient_name}
          locationName={locationName(cancelTarget.location_id)}
          outboundTime={new Date(cancelTarget.outbound_time).toLocaleDateString('zh-TW')}
          sameBatchCount={sameBatchCount(cancelTarget)}
          submitting={cancelling}
          onCancel={() => setCancelTarget(null)}
          onConfirm={(reason) => void confirmCancel(reason)}
        />
      )}

      {detailTarget && (() => {
        const rows = batchOf(detailTarget)
        const totalQty = rows.reduce((s, l) => s + l.outbound_quantity, 0)
        return (
          <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title"><i className="bi bi-eye" /> 領用單詳情</h5>
                  <button type="button" className="btn-close" onClick={() => setDetailTarget(null)} />
                </div>
                <div className="modal-body">
                  <div className="card bg-light border mb-3"><div className="card-body">
                    <div className="row g-2">
                      <div className="col-sm-6"><div className="text-muted small">領用時間</div><div className="fw-bold">{new Date(detailTarget.outbound_time).toLocaleDateString('zh-TW')}</div></div>
                      <div className="col-sm-6"><div className="text-muted small">發放據點</div><div className="fw-bold">{locationName(detailTarget.location_id)}</div></div>
                      <div className="col-sm-6"><div className="text-muted small">使用人</div><div className="fw-bold">{detailTarget.recipient_name}</div></div>
                      <div className="col-sm-6"><div className="text-muted small">聯絡方式</div><div>{detailTarget.recipient_contact || '—'}</div></div>
                      <div className="col-sm-6"><div className="text-muted small">所屬鄉鎮</div><div>{detailTarget.recipient_precinct ? `${detailTarget.recipient_precinct} / ` : ''}{detailTarget.recipient_district ?? '—'}</div></div>
                      <div className="col-sm-6"><div className="text-muted small">身分別</div><div><span className={`badge ${recipientIdentityBadgeClass(detailTarget.recipient_identity)}`}>{recipientIdentityDisplayName(detailTarget.recipient_identity)}</span></div></div>
                      <div className="col-sm-6"><div className="text-muted small">操作人員</div><div>{detailTarget.operator}</div></div>
                      {detailTarget.remark && <div className="col-12"><div className="text-muted small">備註</div><div style={{ whiteSpace: 'pre-wrap' }}>{detailTarget.remark}</div></div>}
                    </div>
                  </div></div>
                  <div className="table-responsive border rounded">
                    <table className="table table-sm align-middle mb-0">
                      <thead className="table-light"><tr><th style={{ width: 40 }}>#</th><th>物資</th><th className="col-min">規格</th><th className="col-min text-end">數量</th></tr></thead>
                      <tbody>
                        {rows.map((l, i) => (
                          <tr key={l.id}>
                            <td className="text-muted">{i + 1}</td>
                            <td><strong>{itemOf(l.supply_item_id)?.item_name ?? `物資 #${l.supply_item_id}`}</strong><div className="text-muted small">{itemOf(l.supply_item_id)?.category}</div></td>
                            <td className="col-min">{itemOf(l.supply_item_id)?.specification?.trim() || '無'}</td>
                            <td className="col-min text-end"><strong>{l.outbound_quantity}</strong> {itemOf(l.supply_item_id)?.unit ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="table-light"><tr><td colSpan={3} className="text-end fw-bold">合計</td><td className="text-end fw-bold">{rows.length} 項／{totalQty} 件</td></tr></tfoot>
                    </table>
                  </div>
                  {detailTarget.batch_id && rows.length > 1 && <div className="form-text mt-2">此為同一批（batch）{rows.length} 項物資的完整領用單。</div>}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-primary" onClick={() => printReceipt(detailTarget)}><i className="bi bi-printer" /> 列印領用單</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setDetailTarget(null)}>關閉</button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {editTarget && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content">
              <form onSubmit={submitEdit}>
                <div className="modal-header">
                  <h5 className="modal-title"><i className="bi bi-pencil" /> 修改領用紀錄</h5>
                  <button type="button" className="btn-close" onClick={() => setEditTarget(null)} />
                </div>
                <div className="modal-body">
                  <div className="alert alert-light border small mb-3">
                    {locationName(editTarget.location_id)}｜領用時間 {new Date(editTarget.outbound_time).toLocaleDateString('zh-TW')}｜操作人 {editTarget.operator}
                    <div className="text-muted">改數量／品項會自動回算庫存（退回原批次、再扣新的）。</div>
                  </div>
                  <div className="row">
                    <div className="col-md-8 mb-3">
                      <label className="form-label">物資（同據點批次）*</label>
                      <select className="form-select" value={editForm.supplyItemId} onChange={(e) => setEditForm({ ...editForm, supplyItemId: Number(e.target.value) })}>
                        {items
                          .filter((i) => i.location_id === editTarget.location_id && (i.is_active || i.id === editTarget.supply_item_id))
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.category}／{i.item_name}{i.specification ? `（${i.specification}）` : ''}－現有 {i.quantity} {i.unit ?? ''}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">領用數量 *</label>
                      <input className="form-control" type="number" min={1} value={editForm.quantity} onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })} />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">使用人姓名 *</label>
                      <input className="form-control" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">使用人電話</label>
                      <input className="form-control" value={editForm.contact} onChange={(e) => setEditForm({ ...editForm, contact: e.target.value })} />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">所屬鄉鎮 *</label>
                      <div className="input-group">
                        <input className="form-control" readOnly placeholder="請選擇" value={editForm.district ? `${editForm.precinct ?? ''}／${editForm.district}` : ''} />
                        <button type="button" className="btn btn-outline-primary" onClick={() => setShowEditDistrict(true)}>選擇</button>
                      </div>
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label d-block">身分別 *</label>
                      <div className="btn-group flex-wrap" role="group">
                        {AllRecipientIdentities.map((idv) => (
                          <button key={idv} type="button" className={`btn btn-sm ${editForm.identity === idv ? 'btn-dark' : 'btn-outline-secondary'}`} onClick={() => setEditForm({ ...editForm, identity: idv })}>
                            {recipientIdentityDisplayName(idv)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="col-12 mb-3">
                      <label className="form-label">備註</label>
                      <textarea className="form-control" rows={2} value={editForm.remark} onChange={(e) => setEditForm({ ...editForm, remark: e.target.value })} />
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setEditTarget(null)}>取消</button>
                  <button type="submit" className="btn btn-primary" disabled={editSaving}>{editSaving ? '儲存中…' : '儲存變更'}</button>
                </div>
              </form>
            </div>
          </div>
          {showEditDistrict && (
            <DistrictPickerModal
              currentPrecinct={editForm.precinct}
              currentDistrict={editForm.district}
              onCancel={() => setShowEditDistrict(false)}
              onSelect={(precinct, district) => {
                setEditForm((f) => ({ ...f, precinct, district }))
                setShowEditDistrict(false)
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}
