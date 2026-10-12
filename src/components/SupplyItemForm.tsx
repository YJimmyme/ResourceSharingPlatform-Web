// Shared 物資入庫 (add supply_item) form. Create-only: inserts one or more
// supply_item batches (RLS-gated, location-scoped for non-Admin), uploads each
// photo per the naming convention, and resolves safety stock from the selected
// location + definition. Supports multiple items in one submission (same donor
// / location) since a single donor often gives several items at once.
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { uploadItemPhoto } from '../lib/imageUpload'
import { StockTypes, AllStockTypes, stockTypeDisplayName, Roles } from '../lib/enums'
import { useAuth } from '../hooks/useAuth'
import { ConfirmActionModal } from './ConfirmActionModal'
import { DateSelect } from './DateSelect'
import { logActivity } from '../lib/activityLog'
import type {
  SupplyLocation,
  LocationInventorySafetyStock,
  InventoryItemDefinition,
  InventoryItemVariant,
} from '../types/db'

// 每一筆品項的表單狀態（分類、種類、名稱、規格、數量、效期、圖片各自獨立）。
type ItemState = {
  key: string
  stockType: string
  category: string
  itemName: string
  variantId: string // '' = 無（未指定）
  quantity: string
  expirationDate: string
  photoFile: File | null
}

// 共用欄位：據點、備註、捐贈人。
type SharedState = {
  locationId: string
  remark: string
  donorName: string
  donorContact: string
  donorAddress: string
}
const emptyShared: SharedState = {
  locationId: '', remark: '', donorName: '', donorContact: '', donorAddress: '',
}

function newItem(): ItemState {
  return {
    key: (globalThis.crypto?.randomUUID?.() ?? String(Math.random())),
    stockType: StockTypes.HasExpiry,
    category: '', itemName: '', variantId: '',
    quantity: '', expirationDate: '', photoFile: null,
  }
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort()
}

export function SupplyItemForm({
  onSaved,
  onCancel,
  submitLabel = '確認入庫',
}: {
  onSaved?: (message: string) => void
  onCancel?: () => void
  submitLabel?: string
}) {
  const { profile } = useAuth()
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [safetyStocks, setSafetyStocks] = useState<LocationInventorySafetyStock[]>([])
  const [definitions, setDefinitions] = useState<InventoryItemDefinition[]>([])
  const [variants, setVariants] = useState<InventoryItemVariant[]>([])
  const [shared, setShared] = useState<SharedState>(emptyShared)
  const [items, setItems] = useState<ItemState[]>([newItem()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 送出前確認視窗（p.13）：先驗證再跳出核對，按「確認入庫」才真正寫入。
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('supply_location').select('*').eq('is_active', true).order('id'),
      supabase.from('location_inventory_safety_stock').select('*'),
      supabase.from('inventory_item_definition').select('*').eq('is_active', true),
      supabase.from('inventory_item_variant').select('*').eq('is_active', true),
    ]).then(([locRes, safetyRes, defRes, varRes]) => {
      setLocations((locRes.data ?? []) as SupplyLocation[])
      setSafetyStocks((safetyRes.data ?? []) as LocationInventorySafetyStock[])
      setDefinitions((defRes.data ?? []) as InventoryItemDefinition[])
      setVariants((varRes.data ?? []) as InventoryItemVariant[])
    })
  }, [])

  useEffect(() => {
    // 所有帳號（包含管理員）先帶入個人所屬據點；管理員僅是保留切換權限。
    if (profile?.location_id) {
      setShared((current) => ({ ...current, locationId: String(profile.location_id) }))
    }
  }, [profile])

  // ── 依 definitions/variants 推導每一筆品項的下拉選項 ─────────────────
  const categoriesByType = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const st of AllStockTypes) {
      map[st] = uniqueSorted(definitions.filter((d) => d.stock_type === st).map((d) => d.category))
    }
    return map
  }, [definitions])

  function itemNamesFor(stockType: string, category: string): string[] {
    return uniqueSorted(
      definitions.filter((d) => d.stock_type === stockType && d.category === category).map((d) => d.item_name)
    )
  }
  function definitionFor(item: ItemState): InventoryItemDefinition | null {
    return (
      definitions.find(
        (d) => d.stock_type === item.stockType && d.category === item.category && d.item_name === item.itemName
      ) ?? null
    )
  }
  function variantsForDef(defId: number): InventoryItemVariant[] {
    return variants.filter((v) => v.inventory_item_definition_id === defId)
  }
  function variantFor(item: ItemState): InventoryItemVariant | null {
    return item.variantId ? variants.find((v) => v.id === Number(item.variantId)) ?? null : null
  }
  function resolvedSafetyStock(defId: number): number {
    if (!shared.locationId) return 0
    const row = safetyStocks.find(
      (s) => s.location_id === Number(shared.locationId) && s.inventory_item_definition_id === defId
    )
    return row?.safety_stock ?? 0
  }

  // ── 品項增刪與更新 ──────────────────────────────────────────────
  function updateItem(key: string, patch: Partial<ItemState>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }
  function addItem() {
    setItems((prev) => [...prev, newItem()])
  }
  function removeItem(key: string) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.key !== key)))
  }

  function resetForm() {
    setShared({ ...emptyShared, locationId: profile?.location_id ? String(profile.location_id) : '' })
    setItems([newItem()])
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!shared.locationId) {
      setError('請選擇所在據點')
      return
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const label = `品項 ${i + 1}`
      if (!definitionFor(it)) {
        setError(`${label}：請選擇物資種類與名稱`)
        return
      }
      if (it.stockType !== StockTypes.NoExpiry && !it.expirationDate) {
        setError(`${label}：有效期物資／冷凍食品必須填寫有效期限`)
        return
      }
      if (!it.quantity || Number(it.quantity) <= 0) {
        setError(`${label}：請輸入大於 0 的入庫數量`)
        return
      }
    }
    // 驗證通過：跳出確認視窗，等使用者核對後才真的入庫。
    setConfirmOpen(true)
  }

  function locationName(id: number): string {
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  async function doStockIn() {
    setError(null)
    setSaving(true)

    const donorName = shared.donorName.trim()
    const donorContact = shared.donorContact.trim()
    const donorAddress = shared.donorAddress.trim()
    const remark = shared.remark.trim()
    const locationId = Number(shared.locationId)

    // 1) 先把每一筆品項的圖片都上傳完成（任何一張失敗就整批中止，不寫入庫存）。
    const prepared: { item: ItemState; def: InventoryItemDefinition; variant: InventoryItemVariant | null; imagePath: string | null }[] = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const def = definitionFor(it)
      if (!def) continue
      const variant = variantFor(it)
      let imagePath: string | null = null
      if (it.photoFile) {
        const { path, error: uploadError } = await uploadItemPhoto(it.photoFile, {
          definitionId: def.id,
          category: def.category,
          itemName: def.item_name,
          specification: variant?.specification ?? null,
          quantity: Number(it.quantity),
        })
        if (uploadError) {
          setError(`品項 ${i + 1} 圖片上傳失敗：${uploadError}`)
          setSaving(false)
          setConfirmOpen(false)
          return
        }
        imagePath = path
      }
      prepared.push({ item: it, def, variant, imagePath })
    }

    // 2) 一次插入所有 supply_item（回傳 id 依序對應）。
    const operator = profile?.display_name ?? profile?.username ?? null
    const payloads = prepared.map(({ item, def, variant, imagePath }) => ({
      category: def.category,
      item_name: def.item_name,
      specification: variant?.specification ?? null,
      unit: def.unit,
      stock_type: item.stockType,
      quantity: Number(item.quantity),
      expiration_date: item.stockType === StockTypes.NoExpiry ? null : item.expirationDate,
      location_id: locationId,
      inventory_item_variant_id: variant ? variant.id : null,
      safety_stock: resolvedSafetyStock(def.id),
      remark: remark || null,
      created_by: operator,
      ...(imagePath ? { image_path: imagePath } : {}),
    }))

    const result = await supabase.from('supply_item').insert(payloads).select('id')
    if (result.error || !result.data) {
      setSaving(false)
      setConfirmOpen(false)
      setError(result.error?.message ?? '入庫寫入失敗')
      return
    }

    // 3) 依序建立入庫來源紀錄（捐贈人／操作人／數量）。
    const logRows = result.data.map((row, idx) => ({
      supply_item_id: row.id,
      location_id: locationId,
      stock_in_quantity: Number(prepared[idx].item.quantity),
      donor_name: donorName || null,
      donor_contact: donorContact || null,
      donor_address: donorAddress || null,
      operator,
      remark: remark || null,
    }))
    const { error: stockInLogError } = await supabase.from('supply_stock_in_log').insert(logRows)
    if (stockInLogError) {
      setSaving(false)
      setConfirmOpen(false)
      setError(`入庫已建立，但入庫來源紀錄寫入失敗：${stockInLogError.message}`)
      return
    }

    setSaving(false)
    setConfirmOpen(false)
    const count = prepared.length
    const asDonation = donorName.length > 0
    void logActivity({
      action: 'stock_in', category: '庫存異動', targetTable: 'supply_item', locationId,
      summary: `入庫 ${count} 筆品項${asDonation ? `（捐贈人 ${donorName}）` : ''}`,
      detail: { items: prepared.map((p) => ({ name: p.def.item_name, quantity: Number(p.item.quantity) })), donor: donorName || null },
    })
    resetForm()
    const base = count > 1 ? `已入庫 ${count} 筆品項` : `「${prepared[0].def.item_name}」已入庫`
    onSaved?.(asDonation ? `${base}，並記錄捐贈人` : `${base}，可稍後補登捐贈人資料`)
  }

  return (
    <>
    <form onSubmit={handleSubmit}>
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card shadow-sm mb-4"><div className="card-header bg-light"><i className="bi bi-geo-alt" /> 步驟一：所在據點</div><div className="card-body">
        <label className="form-label">據點 *</label>
        <select className="form-select" required disabled={profile?.role_name !== Roles.Admin} value={shared.locationId} onChange={(e) => setShared({ ...shared, locationId: e.target.value })}>
          <option value="">請選擇據點</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.location_name}</option>)}
        </select>
        {profile?.role_name !== Roles.Admin && <div className="form-text">已預設為你的所屬據點；僅管理員可切換。</div>}
      </div></div>

      <div className="d-flex justify-content-between align-items-center mb-2">
        <h5 className="mb-0"><i className="bi bi-box-seam" /> 步驟二：物資資訊</h5>
        <span className="text-muted small">共 {items.length} 筆品項（同一位捐贈人可一次入庫多筆）</span>
      </div>

      {items.map((it, idx) => {
        const def = definitionFor(it)
        const specVariants = def ? variantsForDef(def.id) : []
        return (
          <div key={it.key} className="card shadow-sm mb-3">
            <div className="card-header bg-light d-flex justify-content-between align-items-center">
              <span><i className="bi bi-box" /> 品項 {idx + 1}</span>
              {items.length > 1 && (
                <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removeItem(it.key)}>
                  <i className="bi bi-trash" /> 移除
                </button>
              )}
            </div>
            <div className="card-body">
              <div className="mb-3">
                <label className="form-label d-block">分類</label>
                <div className="btn-group" role="group">
                  {AllStockTypes.map((st) => (
                    <button
                      key={st}
                      type="button"
                      className={`btn btn-outline-primary ${it.stockType === st ? 'active' : ''}`}
                      onClick={() => updateItem(it.key, { stockType: st, category: '', itemName: '', variantId: '' })}
                    >
                      {stockTypeDisplayName(st)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="row">
                <div className="col-md-4 mb-3">
                  <label className="form-label">物資種類 *</label>
                  <select className="form-select" required value={it.category} onChange={(e) => updateItem(it.key, { category: e.target.value, itemName: '', variantId: '' })}>
                    <option value="">請選擇物資種類</option>
                    {(categoriesByType[it.stockType] ?? []).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="col-md-4 mb-3">
                  <label className="form-label">物資名稱 *</label>
                  <select className="form-select" required disabled={!it.category} value={it.itemName} onChange={(e) => updateItem(it.key, { itemName: e.target.value, variantId: '' })}>
                    <option value="">請先選擇物資種類</option>
                    {itemNamesFor(it.stockType, it.category).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div className="col-md-4 mb-3">
                  <label className="form-label">規格</label>
                  <select className="form-select" disabled={!it.itemName} value={it.variantId} onChange={(e) => updateItem(it.key, { variantId: e.target.value })}>
                    <option value="">{it.itemName ? '無（未指定，可稍後由總管補規格）' : '請先選擇物資名稱'}</option>
                    {specVariants.map((v) => (
                      <option key={v.id} value={v.id}>{v.specification ?? '無規格'}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="row">
                <div className="col-md-4 mb-3">
                  <label className="form-label">目前數量 *</label>
                  <input className="form-control" type="number" min={0} required value={it.quantity} onChange={(e) => updateItem(it.key, { quantity: e.target.value })} />
                </div>
                <div className="col-md-4 mb-3">
                  <label className="form-label">單位</label>
                  <input className="form-control" disabled value={def?.unit ?? ''} />
                </div>
              </div>

              {it.stockType !== StockTypes.NoExpiry && (
                <div className="mb-3">
                  <label className="form-label">有效期限 *</label>
                  <DateSelect value={it.expirationDate} onChange={(v) => updateItem(it.key, { expirationDate: v })} />
                </div>
              )}

              <div className="mb-3">
                <label className="form-label">物資圖片</label>
                <input className="form-control" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => updateItem(it.key, { photoFile: e.target.files?.[0] ?? null })} />
                <div className="form-text">支援 jpg、png、webp，大小 5MB 以內</div>
              </div>
            </div>
          </div>
        )
      })}

      <div className="mb-4">
        <button type="button" className="btn btn-outline-primary" onClick={addItem}>
          <i className="bi bi-plus-circle" /> 新增品項
        </button>
      </div>

      <div className="card shadow-sm mb-4"><div className="card-header bg-light"><i className="bi bi-person-heart" /> 步驟三：捐贈人資訊 <span className="text-muted small">（可稍後補登，套用到本次全部品項）</span></div><div className="card-body">
      <div className="row">
        <div className="col-md-6 mb-3">
          <label className="form-label">捐贈人姓名</label>
          <input className="form-control" placeholder="例如：陳先生／某某企業（選填）" value={shared.donorName} onChange={(e) => setShared({ ...shared, donorName: e.target.value })} />
          <div className="form-text">填寫後，本次入庫的捐贈人會出現在「捐贈分析」（含物流追蹤）。</div>
        </div>
        <div className="col-md-6 mb-3">
          <label className="form-label">捐贈者電話</label>
          <input className="form-control" placeholder="例如：0912-345-678（選填）" value={shared.donorContact} onChange={(e) => setShared({ ...shared, donorContact: e.target.value })} />
        </div>
        <div className="col-md-12 mb-3"><label className="form-label">捐贈者地址</label><input className="form-control" placeholder="例如：雲林縣斗六市…（選填）" value={shared.donorAddress} onChange={(e) => setShared({ ...shared, donorAddress: e.target.value })} /></div>
      </div>

      <div className="mb-3">
        <label className="form-label">備註</label>
        <textarea className="form-control" rows={2} value={shared.remark} onChange={(e) => setShared({ ...shared, remark: e.target.value })} />
      </div>
      </div></div>

      <div className="d-flex justify-content-end gap-2">
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            取消
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? '儲存中…' : submitLabel}
        </button>
      </div>
    </form>

    {confirmOpen && (
      <ConfirmActionModal
        title="確認本次入庫內容"
        icon="bi-box-arrow-in-down"
        confirmLabel="確認入庫"
        submitting={saving}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void doStockIn()}
        fields={[
          { label: '入庫據點', value: locationName(Number(shared.locationId)) },
          { label: '操作人員', value: profile?.display_name ?? profile?.username ?? '—' },
          { label: '品項筆數', value: `${items.length} 筆` },
          { label: '捐贈人', value: shared.donorName.trim() || <span className="text-muted">未填</span> },
          { label: '捐贈者電話', value: shared.donorContact.trim() || <span className="text-muted">未填</span> },
          ...(shared.donorAddress.trim() ? [{ label: '捐贈者地址', value: shared.donorAddress.trim(), full: true }] : []),
          ...(shared.remark.trim() ? [{ label: '備註', value: shared.remark.trim(), full: true }] : []),
        ]}
        items={items.map((it) => {
          const def = definitionFor(it)
          const variant = variantFor(it)
          return {
            name: def?.item_name ?? '—',
            category: def?.category ?? '',
            spec: variant?.specification ?? null,
            expiration: it.stockType === StockTypes.NoExpiry ? null : it.expirationDate,
            quantity: Number(it.quantity),
            unit: def?.unit ?? '',
          }
        })}
        extraHeader="入庫數量"
        warning={<>按下「確認入庫」後會<strong>立刻建立庫存</strong>。請再確認一次上面的品項與數量。</>}
      />
    )}
    </>
  )
}
