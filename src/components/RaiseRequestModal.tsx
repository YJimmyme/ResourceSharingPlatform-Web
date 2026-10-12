// 「舉手」提出缺料需求的彈窗 —— 從 StatusList 抽出來共用。
// 兩種來源：
//   一般列（target.locationId 有值）：來源據點＝該物資所在據點，固定帶入。
//   總量不足列（target.locationId == null）：需從「有庫存的其他據點」挑來源。
// 送出後寫入 supply_request（status=Open）給總管審核，並記錄操作稽核。
import { useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { logActivity } from '../lib/activityLog'
import type { SupplyItem, SupplyLocation } from '../types/db'

export interface RaiseTarget {
  category: string
  item_name: string
  specification: string | null
  unit: string | null
  locationId: number | null // null = 總量不足（全系統），需挑來源據點
  quantity: number | null // 目前數量（該據點或全系統總量，純顯示用）
}

interface Props {
  target: RaiseTarget
  locations: SupplyLocation[]
  items: SupplyItem[] // 用來算「哪些據點有此品項庫存」
  onClose: () => void
  onDone: (flash: string) => void
}

export function RaiseRequestModal({ target, locations, items, onClose, onDone }: Props) {
  const { profile } = useAuth()
  const myLocId: number | null = profile?.location_id ?? null
  const [srcLocationId, setSrcLocationId] = useState('')
  const [reqLocationId, setReqLocationId] = useState(profile?.location_id ? String(profile.location_id) : '')
  const [reqQuantity, setReqQuantity] = useState('1')
  const [reqNote, setReqNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isGlobalRow = target.locationId == null
  const sameLocation = target.locationId != null && target.locationId === myLocId

  function locationName(id: number | null): string {
    if (id == null) return '（全系統）'
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  // 總量不足時：可挑「有此品項庫存」的其他據點（顯示現有數量）。
  const sourceOptions = useMemo(() => {
    const byLoc = new Map<number, number>()
    for (const it of items) {
      if (
        it.category === target.category &&
        it.item_name === target.item_name &&
        (it.specification ?? '') === (target.specification ?? '') &&
        it.quantity > 0 &&
        it.location_id !== myLocId
      ) {
        byLoc.set(it.location_id, (byLoc.get(it.location_id) ?? 0) + it.quantity)
      }
    }
    return [...byLoc.entries()].map(([locId, qty]) => ({ locId, qty })).sort((a, b) => b.qty - a.qty)
  }, [items, target, myLocId])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const reqLoc = myLocId ?? (reqLocationId ? Number(reqLocationId) : null)
    const srcLoc = isGlobalRow ? (srcLocationId ? Number(srcLocationId) : null) : target.locationId
    if (!reqLoc) return setError('無法判斷你的據點，請先選擇')
    if (!srcLoc) return setError('請選擇來源據點')
    if (reqLoc === srcLoc) return setError('此物資就在你的據點，無需向自己調貨')
    const qty = Number(reqQuantity)
    if (!Number.isInteger(qty) || qty <= 0) return setError('數量必須是大於 0 的整數')

    setSaving(true)
    const { error: insErr } = await supabase.from('supply_request').insert({
      category: target.category,
      item_name: target.item_name,
      specification: target.specification,
      requesting_location_id: reqLoc,
      source_location_id: srcLoc,
      quantity: qty,
      requested_by: profile?.display_name ?? profile?.username ?? null,
      note: reqNote.trim() || null,
      status: 'Open',
    })
    setSaving(false)
    if (insErr) return setError(insErr.message)
    void logActivity({
      action: 'request_raise',
      category: '申請',
      targetTable: 'supply_request',
      locationId: reqLoc,
      summary: `舉手缺料「${target.item_name}」${qty} ${target.unit ?? ''}`,
      detail: { source_location_id: srcLoc, quantity: qty },
    })
    onDone(`已提出需求：${target.item_name} ${qty} ${target.unit ?? ''}`)
  }

  return (
    <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <form onSubmit={submit}>
            <div className="modal-header">
              <h5 className="modal-title">
                <i className="bi bi-hand-index-thumb" /> 提出缺料需求
              </h5>
              <button type="button" className="btn-close" onClick={onClose} />
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="alert alert-light border small mb-3">
                品項：<strong>{target.item_name}</strong>
                {target.specification ? `／${target.specification}` : ''}（{target.category}）
              </div>

              <div className="mb-3">
                <label className="form-label">需求據點（你的據點）</label>
                {myLocId != null ? (
                  <input className="form-control" disabled value={locationName(myLocId)} />
                ) : (
                  <select className="form-select" required value={reqLocationId} onChange={(e) => setReqLocationId(e.target.value)}>
                    <option value="">請選擇你的據點</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.location_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="mb-3">
                <label className="form-label">來源據點（物資所在） *</label>
                {isGlobalRow ? (
                  <>
                    <select className="form-select" required value={srcLocationId} onChange={(e) => setSrcLocationId(e.target.value)}>
                      <option value="">請選擇有庫存的據點</option>
                      {sourceOptions.map((s) => (
                        <option key={s.locId} value={s.locId}>
                          {locationName(s.locId)}（現有 {s.qty} {target.unit ?? ''}）
                        </option>
                      ))}
                    </select>
                    {sourceOptions.length === 0 && <div className="form-text text-danger">目前其他據點都沒有此品項的庫存。</div>}
                  </>
                ) : (
                  <input
                    className="form-control"
                    disabled
                    value={`${locationName(target.locationId)}（現有 ${target.quantity ?? '?'} ${target.unit ?? ''}）`}
                  />
                )}
              </div>

              {sameLocation && <div className="alert alert-warning py-2 small mb-3">此物資就在你的據點，無需向自己調貨。</div>}

              <div className="mb-3">
                <label className="form-label">需求數量 *</label>
                <input className="form-control" type="number" min={1} required value={reqQuantity} onChange={(e) => setReqQuantity(e.target.value)} />
              </div>
              <div className="mb-3">
                <label className="form-label">備註</label>
                <textarea className="form-control" rows={2} value={reqNote} onChange={(e) => setReqNote(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                取消
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving || sameLocation || (isGlobalRow && sourceOptions.length === 0)}>
                {saving ? '送出中…' : '送出需求'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
