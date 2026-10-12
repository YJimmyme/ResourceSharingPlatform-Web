// 物資領用專用的四個彈出視窗。只有 SupplyOutbound.tsx 會 import，
// 捐贈／報廢／轉移完全不受影響（那三頁仍然走 StockBatchPicker）。
//
//   建立頁：
//   1) DistrictPickerModal     — 依分區列出鄉鎮市，直接點選
//   2) OutboundItemPickerModal — 可領用物資明細 + 當場輸入數量，加進批次清單
//   3) OutboundConfirmModal    — 送出前的最後確認，列出整張領用單
//   紀錄頁：
//   4) OutboundCancelModal     — 取消單一品項的領用，數量退回原批次
//
// 版型沿用專案既有的「純 CSS Bootstrap modal」寫法（見 InventoryTypes.tsx、
// AccountManagement.tsx）：不掛 bootstrap 的 JS，只靠 .modal.d-block + 自畫遮罩。
import { useEffect, useMemo, useState } from 'react'
import { YunlinPrecincts, recipientIdentityBadgeClass, recipientIdentityDisplayName } from '../lib/yunlinDistricts'
import { expiryAlert, batchLabel } from '../lib/stockBatch'
import { itemPhotoUrl } from '../lib/imageUpload'
import { AllStockTypes, stockTypeDisplayName } from '../lib/enums'
import type { SupplyItem } from '../types/db'

// ============================================================================
// 1) 所屬鄉鎮選擇：依分區列出鄉鎮市
// ============================================================================
export function DistrictPickerModal({
  currentDistrict,
  onCancel,
  onSelect,
}: {
  currentPrecinct: string | null
  currentDistrict: string | null
  onCancel: () => void
  onSelect: (precinct: string, district: string) => void
}) {
  return (
    <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              <i className="bi bi-geo-alt" /> 選擇使用人所屬鄉鎮
            </h5>
            <button type="button" className="btn-close" onClick={onCancel} />
          </div>
          <div className="modal-body">
            <p className="text-muted small">
              直接點選鄉鎮市即可（依分區列出，範圍為雲林縣全部 20 個鄉鎮市）。
            </p>
            {YunlinPrecincts.map((p) => (
              <div className="card mb-2" key={p.name}>
                <div className="card-header bg-light d-flex justify-content-between align-items-center py-2">
                  <span>
                    <i className="bi bi-building" /> {p.name}
                  </span>
                  <span className="badge bg-secondary">{p.townships.length} 個鄉鎮市</span>
                </div>
                <div className="card-body d-flex flex-wrap gap-2">
                  {p.townships.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`btn btn-sm ${currentDistrict === t ? 'btn-primary' : 'btn-outline-primary'}`}
                      onClick={() => onSelect(p.name, t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// 2) 批次領用的物資挑選：明細清單 + 數量
// ============================================================================
export function OutboundItemPickerModal({
  items,
  loading,
  remainingOf,
  onCancel,
  onAdd,
  title = '加入要派送的物資',
  quantityLabel = '領用數量',
  availableLabel = '可領數量',
  emptyText = '這個據點沒有符合條件的可領用物資',
}: {
  /** 已由 useItemPicker 依「所選據點 + 有庫存」過濾過的物資 */
  items: SupplyItem[]
  loading: boolean
  /** 扣掉批次清單裡已經加進去的數量之後，這個批次還剩多少可以領 */
  remainingOf: (item: SupplyItem) => number
  onCancel: () => void
  onAdd: (item: SupplyItem, quantity: number) => void
  /** 標題／數量欄位／表頭／空清單文字可依情境覆寫（領用、轉移共用）。 */
  title?: string
  quantityLabel?: string
  availableLabel?: string
  emptyText?: string
}) {
  const [keyword, setKeyword] = useState('')
  const [stockType, setStockType] = useState('')
  const [category, setCategory] = useState('')
  const [selected, setSelected] = useState<SupplyItem | null>(null)
  const [quantity, setQuantity] = useState('1')

  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category))).sort(), [items])

  const rows = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    return items.filter((i) => {
      if (stockType && i.stock_type !== stockType) return false
      if (category && i.category !== category) return false
      if (k && !`${i.item_name} ${i.specification ?? ''} ${i.category}`.toLowerCase().includes(k)) return false
      return true
    })
  }, [items, keyword, stockType, category])

  // 選到的批次若因為改了篩選條件而離開清單，就把選取狀態一起清掉，
  // 避免畫面上看不到卻還按得下「加入清單」。
  useEffect(() => {
    if (selected && !rows.some((r) => r.id === selected.id)) setSelected(null)
  }, [rows, selected])

  const remaining = selected ? remainingOf(selected) : 0
  const qty = Number(quantity)
  const qtyValid = Number.isInteger(qty) && qty > 0 && qty <= remaining

  function pick(item: SupplyItem) {
    setSelected(item)
    setQuantity('1')
  }

  return (
    <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-xl modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              <i className="bi bi-box-seam" /> {title}
            </h5>
            <button type="button" className="btn-close" onClick={onCancel} />
          </div>

          <div className="modal-body">
            <div className="row g-2 mb-3">
              <div className="col-md-5">
                <input
                  className="form-control"
                  placeholder="搜尋物資名稱、規格或種類"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </div>
              <div className="col-md-4">
                <select className="form-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">全部物資種類</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-3">
                <select className="form-select" value={stockType} onChange={(e) => setStockType(e.target.value)}>
                  <option value="">全部分類</option>
                  {AllStockTypes.map((st) => (
                    <option key={st} value={st}>
                      {stockTypeDisplayName(st)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="table-responsive border rounded" style={{ maxHeight: 360 }}>
              <table className="table table-hover table-sm align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th style={{ width: 56 }} />
                    <th>物資</th>
                    <th className="col-min">規格／批次</th>
                    <th className="col-min">{availableLabel}</th>
                    <th className="col-min">效期</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="text-center text-muted py-4">
                        載入中…
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center text-muted py-4">
                        {emptyText}
                      </td>
                    </tr>
                  ) : (
                    rows.map((x) => {
                      const alert = expiryAlert(x)
                      const left = remainingOf(x)
                      const photo = itemPhotoUrl(x.image_path)
                      return (
                        <tr
                          key={x.id}
                          className={selected?.id === x.id ? 'table-primary' : undefined}
                          style={{ cursor: left > 0 ? 'pointer' : 'not-allowed', opacity: left > 0 ? 1 : 0.5 }}
                          onClick={() => left > 0 && pick(x)}
                        >
                          <td>
                            {photo ? (
                              <img
                                src={photo}
                                alt={x.item_name}
                                className="rounded border bg-white"
                                style={{ width: 40, height: 40, objectFit: 'cover' }}
                              />
                            ) : (
                              <span
                                className="d-inline-flex align-items-center justify-content-center rounded border bg-white text-secondary"
                                style={{ width: 40, height: 40 }}
                              >
                                <i className="bi bi-image" />
                              </span>
                            )}
                          </td>
                          <td>
                            <strong>{x.item_name}</strong>
                            <div className="text-muted small">{x.category}</div>
                          </td>
                          <td className="col-min">{x.specification?.trim() || '無'}</td>
                          <td className="col-min">
                            <strong>{left}</strong> {x.unit ?? ''}
                            {left < x.quantity && <span className="text-muted small">／共 {x.quantity}</span>}
                          </td>
                          <td className="col-min">
                            {x.expiration_date ?? '無效期'}
                            {alert && <span className={`badge ms-1 ${alert.badgeClass}`}>{alert.label}</span>}
                          </td>
                          <td className="text-end">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-primary"
                              disabled={left <= 0}
                              onClick={(e) => {
                                e.stopPropagation()
                                pick(x)
                              }}
                            >
                              選取
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {selected && (
              <div className="card bg-light border mt-3">
                <div className="card-body">
                  <div className="fw-bold mb-2">
                    <i className="bi bi-check2-circle" /> {selected.item_name}
                    <span className="text-muted fw-normal"> － {batchLabel(selected)}</span>
                  </div>
                  <div className="row g-2 align-items-end">
                    <div className="col-sm-4">
                      <label className="form-label mb-1">{quantityLabel} *</label>
                      <input
                        className="form-control"
                        type="number"
                        min={1}
                        max={remaining}
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                      />
                    </div>
                    <div className="col-sm-8 text-muted small">
                      此批次尚可加入 {remaining} {selected.unit ?? ''}
                      {remaining < selected.quantity && '（已扣除清單中相同批次的數量）'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!selected || !qtyValid}
              onClick={() => selected && onAdd(selected, qty)}
            >
              <i className="bi bi-plus-lg" /> 加入清單
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// 3) 送出前的最後確認：把整張領用單攤出來給人看過再真的領用
//
// 這一步刻意不做任何驗證 —— 頁面在開這個視窗之前就已經驗過了，
// 這裡只負責「呈現 + 再問一次」，避免兩邊各有一份規則而漸漸不一致。
// ============================================================================
export function OutboundConfirmModal({
  recipientName,
  recipientContact,
  recipientPrecinct,
  recipientDistrict,
  recipientIdentity,
  locationName,
  operatorName,
  remark,
  lines,
  submitting,
  onCancel,
  onConfirm,
}: {
  recipientName: string
  recipientContact: string
  recipientPrecinct: string | null
  recipientDistrict: string | null
  recipientIdentity: string
  locationName: string
  operatorName: string
  remark: string
  lines: { item: SupplyItem; quantity: number }[]
  submitting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const totalQuantity = lines.reduce((sum, l) => sum + l.quantity, 0)

  return (
    <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              <i className="bi bi-clipboard-check" /> 確認本次領用內容
            </h5>
            <button type="button" className="btn-close" disabled={submitting} onClick={onCancel} />
          </div>

          <div className="modal-body">
            <div className="card bg-light border mb-3">
              <div className="card-body">
                <div className="row g-2">
                  <div className="col-sm-6">
                    <div className="text-muted small">使用人</div>
                    <div className="fw-bold">{recipientName}</div>
                  </div>
                  <div className="col-sm-6">
                    <div className="text-muted small">聯絡方式</div>
                    <div>{recipientContact.trim() || <span className="text-muted">未填</span>}</div>
                  </div>
                  <div className="col-sm-6">
                    <div className="text-muted small">所屬鄉鎮</div>
                    <div>
                      {recipientDistrict}
                      {recipientPrecinct && <span className="text-muted small">（{recipientPrecinct}）</span>}
                    </div>
                  </div>
                  <div className="col-sm-6">
                    <div className="text-muted small">身分別</div>
                    <div>
                      <span className={`badge ${recipientIdentityBadgeClass(recipientIdentity)}`}>
                        {recipientIdentityDisplayName(recipientIdentity)}
                      </span>
                    </div>
                  </div>
                  <div className="col-sm-6">
                    <div className="text-muted small">發放據點</div>
                    <div>{locationName}</div>
                  </div>
                  <div className="col-sm-6">
                    <div className="text-muted small">操作人員</div>
                    <div>{operatorName}</div>
                  </div>
                  {remark.trim() && (
                    <div className="col-12">
                      <div className="text-muted small">備註</div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{remark.trim()}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="table-responsive border rounded">
              <table className="table table-sm align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>物資</th>
                    <th className="col-min">規格／批次</th>
                    <th className="col-min">效期</th>
                    <th className="col-min text-end">領用數量</th>
                    <th className="col-min text-end">領用後剩餘</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const alert = expiryAlert(l.item)
                    return (
                      <tr key={l.item.id}>
                        <td className="text-muted">{i + 1}</td>
                        <td>
                          <strong>{l.item.item_name}</strong>
                          <div className="text-muted small">{l.item.category}</div>
                        </td>
                        <td className="col-min">{l.item.specification?.trim() || '無'}</td>
                        <td className="col-min">
                          {l.item.expiration_date ?? '無效期'}
                          {alert && <span className={`badge ms-1 ${alert.badgeClass}`}>{alert.label}</span>}
                        </td>
                        <td className="col-min text-end">
                          <strong>{l.quantity}</strong> {l.item.unit ?? ''}
                        </td>
                        <td className="col-min text-end text-muted">
                          {l.item.quantity - l.quantity} {l.item.unit ?? ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="table-light">
                  <tr>
                    <td colSpan={4} className="text-end fw-bold">
                      合計
                    </td>
                    <td className="text-end fw-bold" colSpan={2}>
                      {lines.length} 項／{totalQuantity} 件
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="alert alert-warning mt-3 mb-0">
              <i className="bi bi-exclamation-triangle" /> 按下「確定領用」後會立刻扣除庫存，且
              <strong>無法直接復原</strong>。請再確認一次上面的品項與數量。
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" disabled={submitting} onClick={onCancel}>
              <i className="bi bi-pencil" /> 返回修改
            </button>
            <button type="button" className="btn btn-primary" disabled={submitting} onClick={onConfirm}>
              <i className="bi bi-check-circle" /> {submitting ? '處理中…' : '確定領用'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// 4) 取消領用的確認視窗（領用紀錄頁用）
//
// 一列 supply_outbound_log 就是一項物資，所以這裡取消的一定是「單一品項」；
// 同一批次的其他品項不受影響，視窗文案也要講清楚這件事。
// ============================================================================
export function OutboundCancelModal({
  itemLabel,
  quantityLabel,
  recipientName,
  locationName,
  outboundTime,
  sameBatchCount,
  submitting,
  onCancel,
  onConfirm,
}: {
  /** 物資名稱（含規格） */
  itemLabel: string
  /** 例如「3 包」 */
  quantityLabel: string
  recipientName: string
  locationName: string
  outboundTime: string
  /** 同一批次還有幾項（不含這一項）；0 代表單筆領用或整批只有這一項 */
  sameBatchCount: number
  submitting: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  return (
    <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              <i className="bi bi-arrow-counterclockwise" /> 取消這筆領用
            </h5>
            <button type="button" className="btn-close" disabled={submitting} onClick={onCancel} />
          </div>

          <div className="modal-body">
            <div className="card bg-light border mb-3">
              <div className="card-body">
                <div className="row g-2">
                  <div className="col-12">
                    <div className="text-muted small">物資</div>
                    <div className="fw-bold">{itemLabel}</div>
                  </div>
                  <div className="col-6">
                    <div className="text-muted small">要退回的數量</div>
                    <div className="fw-bold text-success">＋{quantityLabel}</div>
                  </div>
                  <div className="col-6">
                    <div className="text-muted small">退回據點</div>
                    <div>{locationName}</div>
                  </div>
                  <div className="col-6">
                    <div className="text-muted small">使用人</div>
                    <div>{recipientName}</div>
                  </div>
                  <div className="col-6">
                    <div className="text-muted small">原領用時間</div>
                    <div>{outboundTime}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-3">
              <label className="form-label">取消原因（選填）</label>
              <textarea
                className="form-control"
                rows={2}
                maxLength={200}
                placeholder="例如：登錄錯誤、使用人未到"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            {sameBatchCount > 0 && (
              <div className="alert alert-info mb-2">
                <i className="bi bi-info-circle" /> 這筆屬於一次批次領用，同一批還有其他{' '}
                <strong>{sameBatchCount}</strong> 項物資。
                <strong>只有這一項會被取消</strong>，其他項目要另外分別取消。
              </div>
            )}

            <div className="alert alert-warning mb-0">
              <i className="bi bi-exclamation-triangle" /> 取消後數量會立刻退回原本的庫存批次，
              領用紀錄會保留並標記為「已取消」（不會被刪除）。
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" disabled={submitting} onClick={onCancel}>
              先不要
            </button>
            <button type="button" className="btn btn-danger" disabled={submitting} onClick={() => onConfirm(reason)}>
              <i className="bi bi-arrow-counterclockwise" /> {submitting ? '處理中…' : '確定取消領用'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

