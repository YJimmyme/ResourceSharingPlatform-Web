// 出庫／捐贈／報廢三張建立頁共用的「挑一個既有庫存批次」區塊：
// 據點 + 分類快切 + 種類／名稱／規格批次三層連動 + 已選批次預覽卡。
// 三頁的差異只剩各自的數量/對象欄位與右欄說明，那些留在各自的頁面裡。
// （抽出的理由跟 SupplyItemForm 一樣：同一份實作，不要三份各自演化。）
import { useState } from 'react'
import type { useItemPicker } from '../hooks/useItemPicker'
import { expiryAlert, batchLabel } from '../lib/stockBatch'
import { itemPhotoUrl } from '../lib/imageUpload'
import { locationColorStyle } from '../lib/colors'
import { AllStockTypes, stockTypeDisplayName } from '../lib/enums'
import type { SupplyItem, SupplyLocation } from '../types/db'

export function ExpiringItemsPanel({
  items,
  locations,
  title,
  actionLabel,
  onPick,
  defaultCollapsed = false,
}: {
  items: SupplyItem[]
  locations: SupplyLocation[]
  title: string
  actionLabel: string
  onPick: (item: SupplyItem) => void
  /** 預設收合（資料多時避免佔滿畫面，使用者要看再點開）。 */
  defaultCollapsed?: boolean
}) {
  const [open, setOpen] = useState(!defaultCollapsed)
  if (items.length === 0) return null
  const locationName = (id: number) => locations.find((l) => l.id === id)?.location_name ?? `#${id}`

  return (
    <div className="card border-warning shadow-sm mb-4">
      <button
        type="button"
        className="card-header bg-warning-subtle text-dark d-flex justify-content-between align-items-center w-100 border-0"
        style={{ cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>
          <i className="bi bi-exclamation-triangle-fill" /> {title}
          <span className="badge bg-warning text-dark ms-2">{items.length}</span>
        </span>
        <i className={`bi ${open ? 'bi-chevron-up' : 'bi-chevron-down'}`} />
      </button>
      <div className="table-responsive" style={{ display: open ? undefined : 'none' }}>
        <table className="table table-sm table-hover align-middle mb-0">
          <thead>
            <tr>
              <th>物資</th>
              <th>據點</th>
              <th>庫存</th>
              <th>有效期限</th>
              <th>狀態</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((x) => {
              const alert = expiryAlert(x)
              return (
                <tr key={x.id}>
                  <td>
                    <strong>{x.item_name}</strong>
                    {x.specification && <span className="text-muted"> ／{x.specification}</span>}
                  </td>
                  <td>
                    <span className="badge" style={locationColorStyle(x.location_id)}>
                      {locationName(x.location_id)}
                    </span>
                  </td>
                  <td>
                    {x.quantity} {x.unit}
                  </td>
                  <td>{x.expiration_date}</td>
                  <td>{alert && <span className={`badge ${alert.badgeClass}`}>{alert.label}</span>}</td>
                  <td className="text-end">
                    <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => onPick(x)}>
                      {actionLabel}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function StockBatchPicker({
  isAdmin,
  locations,
  locationId,
  onLocationChange,
  stockTypeFilter,
  onStockTypeChange,
  picker,
}: {
  isAdmin: boolean
  locations: SupplyLocation[]
  locationId: number | null
  onLocationChange: (id: number | null) => void
  stockTypeFilter: string
  onStockTypeChange: (value: string) => void
  picker: ReturnType<typeof useItemPicker>
}) {
  const selected = picker.currentItem
  const selectedAlert = selected ? expiryAlert(selected) : null
  const selectedPhotoUrl = itemPhotoUrl(selected?.image_path)

  return (
    <>
      <div className="mb-3">
        <label className="form-label">據點 *</label>
        {isAdmin ? (
          <select
            className="form-select"
            required
            value={locationId ?? ''}
            onChange={(e) => onLocationChange(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">請選擇據點</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.location_name}
              </option>
            ))}
          </select>
        ) : (
          <input className="form-control" disabled value={locations.find((l) => l.id === locationId)?.location_name ?? ''} />
        )}
      </div>

      <div className="mb-3">
        <label className="form-label d-block">分類</label>
        <div className="btn-group" role="group">
          <button
            type="button"
            className={`btn ${stockTypeFilter === '' ? 'btn-dark' : 'btn-outline-secondary'}`}
            onClick={() => onStockTypeChange('')}
          >
            全部
          </button>
          {AllStockTypes.map((st) => (
            <button
              key={st}
              type="button"
              className={`btn ${stockTypeFilter === st ? 'btn-dark' : 'btn-outline-secondary'}`}
              disabled={picker.items.length > 0 && !picker.availableStockTypes.has(st)}
              onClick={() => onStockTypeChange(st)}
            >
              {stockTypeDisplayName(st)}
            </button>
          ))}
        </div>
      </div>

      <div className="row">
        <div className="col-md-4 mb-3">
          <label className="form-label">物資種類 *</label>
          <select
            className="form-select"
            required
            disabled={!locationId}
            value={picker.category}
            onChange={(e) => picker.setCategory(e.target.value)}
          >
            <option value="">請先選擇據點</option>
            {picker.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-4 mb-3">
          <label className="form-label">物資名稱 *</label>
          <select
            className="form-select"
            required
            disabled={!picker.category}
            value={picker.itemName}
            onChange={(e) => picker.setItemName(e.target.value)}
          >
            <option value="">請先選擇物資種類</option>
            {picker.itemNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-4 mb-3">
          <label className="form-label">規格／批次 *</label>
          <select
            className="form-select"
            required
            disabled={!picker.itemName}
            value={picker.itemId ?? ''}
            onChange={(e) => picker.setItemId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">請先選擇物資名稱</option>
            {picker.batches.map((b) => (
              <option key={b.id} value={b.id}>
                {batchLabel(b)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selected && (
        <div className="card bg-light border mb-2">
          <div className="card-body d-flex align-items-center gap-3 flex-wrap">
            {selectedPhotoUrl ? (
              <img
                src={selectedPhotoUrl}
                alt={selected.item_name}
                className="rounded border bg-white"
                style={{ width: 72, height: 72, objectFit: 'cover' }}
              />
            ) : (
              <span
                className="d-inline-flex align-items-center justify-content-center rounded border bg-white text-secondary"
                style={{ width: 72, height: 72 }}
              >
                <i className="bi bi-image fs-2" />
              </span>
            )}
            <div className="d-flex flex-column gap-2">
              <span className="badge bg-primary align-self-start">
                <i className="bi bi-box-seam" /> 現有 {selected.quantity} {selected.unit}
              </span>
              <span className={`badge align-self-start ${selectedAlert ? selectedAlert.badgeClass : 'bg-secondary'}`}>
                <i className="bi bi-calendar-event" />{' '}
                {selected.expiration_date ? `效期 ${selected.expiration_date}` : '無效期'}
                {selectedAlert ? `　！${selectedAlert.label}` : ''}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="form-text mb-3">
        下拉選單只會顯示所選據點與分類下的物資；選了物資種類才能選物資名稱，選了物資名稱才能選規格／批次；切換據點或分類會清空已選內容。依有效期限由近到遠排序，即期／已過期物資已加註提醒。
      </div>
    </>
  )
}
