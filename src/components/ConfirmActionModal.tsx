// 通用「送出前確認」視窗（分工單 p.13）。
// 版型比照領用的「確認本次領用內容」（OutboundModals.tsx）：上方是本次操作的
// 重點欄位（據點、操作人員…），中間是品項清單（品項／規格／效期／數量），
// 下方黃色提醒 + 返回修改／確定。入庫、捐贈、報廢、轉移等「一按就異動庫存」的
// 操作都套這個元件，讓使用者送出前先核對品項、數量、內容。
//
// 純 CSS Bootstrap modal 寫法（.modal.d-block + 自畫遮罩），與專案其他 modal 一致。
import type { ReactNode } from 'react'

export interface ConfirmField {
  label: string
  value: ReactNode
  /** 佔整列（例如備註）；預設半列。 */
  full?: boolean
}

export interface ConfirmItem {
  name: string
  category?: string | null
  spec?: string | null
  expiration?: string | null
  quantity: number
  unit?: string | null
  /** 效期旁的小標籤，例如「已過期」「即期」。 */
  badge?: { label: string; className: string } | null
  /** 數量右側附註，例如領用後剩餘。 */
  extra?: ReactNode
}

export function ConfirmActionModal({
  title,
  icon = 'bi-clipboard-check',
  fields,
  items,
  extraHeader,
  extraColHeader = '領用後剩餘',
  warning,
  confirmLabel,
  submitting,
  onCancel,
  onConfirm,
}: {
  title: string
  icon?: string
  fields: ConfirmField[]
  items: ConfirmItem[]
  /** 品項數量欄的表頭（領用叫「領用數量」、入庫叫「入庫數量」…）。 */
  extraHeader?: string
  /** 「extra」附註欄的表頭（領用後剩餘／捐贈後庫存…）。 */
  extraColHeader?: string
  warning: ReactNode
  confirmLabel: string
  submitting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const totalQuantity = items.reduce((sum, it) => sum + it.quantity, 0)

  return (
    <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              <i className={`bi ${icon}`} /> {title}
            </h5>
            <button type="button" className="btn-close" disabled={submitting} onClick={onCancel} />
          </div>

          <div className="modal-body">
            <div className="card bg-light border mb-3">
              <div className="card-body">
                <div className="row g-2">
                  {fields.map((f, i) => (
                    <div className={f.full ? 'col-12' : 'col-sm-6'} key={i}>
                      <div className="text-muted small">{f.label}</div>
                      <div className="fw-bold">{f.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {items.length > 0 && (
              <div className="table-responsive border rounded">
                <table className="table table-sm align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th>物資</th>
                      <th className="col-min">規格</th>
                      <th className="col-min">效期</th>
                      <th className="col-min text-end">{extraHeader ?? '數量'}</th>
                      {items.some((it) => it.extra != null) && <th className="col-min text-end">{extraColHeader}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={i}>
                        <td className="text-muted">{i + 1}</td>
                        <td>
                          <strong>{it.name}</strong>
                          {it.category && <div className="text-muted small">{it.category}</div>}
                        </td>
                        <td className="col-min">{it.spec?.trim() || '無'}</td>
                        <td className="col-min">
                          {it.expiration ?? '無效期'}
                          {it.badge && <span className={`badge ms-1 ${it.badge.className}`}>{it.badge.label}</span>}
                        </td>
                        <td className="col-min text-end">
                          <strong>{it.quantity}</strong> {it.unit ?? ''}
                        </td>
                        {items.some((x) => x.extra != null) && <td className="col-min text-end text-muted">{it.extra}</td>}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="table-light">
                    <tr>
                      <td colSpan={4} className="text-end fw-bold">
                        合計
                      </td>
                      <td className="text-end fw-bold" colSpan={items.some((x) => x.extra != null) ? 2 : 1}>
                        {items.length} 項／{totalQuantity} 件
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="alert alert-warning mt-3 mb-0">
              <i className="bi bi-exclamation-triangle" /> {warning}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" disabled={submitting} onClick={onCancel}>
              <i className="bi bi-pencil" /> 返回修改
            </button>
            <button type="button" className="btn btn-primary" disabled={submitting} onClick={onConfirm}>
              <i className="bi bi-check-circle" /> {submitting ? '處理中…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
