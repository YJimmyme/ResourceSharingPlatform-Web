// Port of SupplyItemController + Views/SupplyItem/Index.cshtml.
// Read-only list + filters + cross-location summary. Adding stock lives on the
// dedicated 物資入庫 page (/stock-in) — the "物資入庫" button here just links
// there — so the add form has a single implementation (SupplyItemForm).
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { deleteItemPhoto, itemPhotoUrl, itemPhotoDownloadUrl, uploadReplacementPhoto } from '../lib/imageUpload'
import { Roles, StockTypes, AllStockTypes, stockTypeDisplayName, stockTypeBadgeClass } from '../lib/enums'
import { locationColorStyle } from '../lib/colors'
import { FlashMessage } from '../components/FlashMessage'
import { exportToExcel } from '../lib/excelExport'
import { DateSelect } from '../components/DateSelect'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { withinRange } from '../lib/dateRange'
import { fetchLowStock, isItemLowStock, emptyLowStock, type LowStockData } from '../lib/lowStock'
import { EXPIRY_WARNING_DAYS } from '../lib/stockBatch'
import { logActivity } from '../lib/activityLog'
import { RaiseRequestModal, type RaiseTarget } from '../components/RaiseRequestModal'
import type { SupplyItem, SupplyLocation } from '../types/db'

interface ItemSummaryRow {
  itemName: string
  locationCount: number
  totalQuantity: number
  unit: string
  hasLowStock: boolean
  nearestExpirationDate: string | null
}

function today(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function itemStatus(item: SupplyItem, low: LowStockData): { label: string; badgeClass: string } {
  // 低庫存改用統一來源判斷（見 lib/lowStock.ts），不再用逐列 quantity<=safety_stock。
  if (isItemLowStock(item, low)) return { label: '低庫存', badgeClass: 'bg-danger' }
  if (item.expiration_date) {
    const exp = new Date(item.expiration_date)
    if (exp < today()) return { label: '已過期', badgeClass: 'bg-dark' }
    const in30 = new Date(today())
    in30.setDate(in30.getDate() + EXPIRY_WARNING_DAYS)
    if (exp <= in30) return { label: '即將過期', badgeClass: 'bg-warning text-dark' }
  }
  return { label: '正常', badgeClass: 'bg-success' }
}

export function SupplyItems() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const isCadre = profile?.role_name === Roles.Cadre
  const myLocId = profile?.location_id ?? null
  // 物資清單操作權限：總管不限；幫主只能操作自己據點的物資；小幫手唯讀。
  const canOperate = (item: SupplyItem) => isAdmin || (isCadre && item.location_id === myLocId)
  const [searchParams] = useSearchParams()
  const [items, setItems] = useState<SupplyItem[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  // 目錄定義 + 規格：編輯時補規格用（依 種類+名稱 找定義，列出其規格）。
  const [definitions, setDefinitions] = useState<{ id: number; category: string; item_name: string }[]>([])
  const [variants, setVariants] = useState<{ id: number; inventory_item_definition_id: number; specification: string | null; is_active: boolean }[]>([])
  const [lowStock, setLowStock] = useState<LowStockData>(emptyLowStock)
  // 據點門檻（location_inventory_safety_stock）：物資清單「安全庫存」直接顯示此值，
  // 與「庫存種類設定 → 據點門檻」同一來源，讀取用。
  const [safetyStocks, setSafetyStocks] = useState<{ location_id: number; inventory_item_definition_id: number; safety_stock: number }[]>([])
  // 總量不足（全系統）判斷用：global_low_stock_view 的 種類|名稱|規格 集合。
  const [globalLowKeys, setGlobalLowKeys] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 操作欄的三個彈窗：放大照片、詳細資料、編輯
  const [photoPreview, setPhotoPreview] = useState<SupplyItem | null>(null)
  const [detailsItem, setDetailsItem] = useState<SupplyItem | null>(null)
  const [editItem, setEditItem] = useState<SupplyItem | null>(null)
  const [editForm, setEditForm] = useState({ quantity: '', expirationDate: '', safetyStock: '', remark: '', variantId: '' })
  const [editPhoto, setEditPhoto] = useState<File | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  // 舉手調貨：幫主在物資清單看別據點物資時，可直接向該據點舉手（總管可直接操作、不需舉手）。
  const [raiseTarget, setRaiseTarget] = useState<RaiseTarget | null>(null)

  // 這筆物資對應的定義底下、可選的規格（供編輯補規格）。
  function variantsFor(item: SupplyItem) {
    const def = definitions.find((d) => d.category === item.category && d.item_name === item.item_name)
    if (!def) return [] as { id: number; specification: string | null }[]
    return variants.filter((v) => v.inventory_item_definition_id === def.id && v.is_active)
  }

  // 這筆物資的「安全庫存」＝該據點此品項（定義）的據點門檻（庫存種類設定所設）。
  // 唯讀顯示，與低庫存判斷同一來源；找不到定義或未設定則為 0。
  function thresholdFor(item: SupplyItem): number {
    const defId =
      lowStock.resolvedByItemId.get(item.id) ??
      definitions.find((d) => d.category === item.category && d.item_name === item.item_name)?.id
    if (defId == null) return 0
    return safetyStocks.find((s) => s.location_id === item.location_id && s.inventory_item_definition_id === defId)?.safety_stock ?? 0
  }

  function openEdit(item: SupplyItem) {
    setEditItem(item)
    setEditForm({
      quantity: String(item.quantity),
      expirationDate: item.expiration_date ?? '',
      safetyStock: String(item.safety_stock),
      remark: item.remark ?? '',
      variantId: item.inventory_item_variant_id ? String(item.inventory_item_variant_id) : '',
    })
    setEditPhoto(null)
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editItem) return
    setEditSaving(true)
    setError(null)

    let imagePath = editItem.image_path
    if (editPhoto) {
      const { path, error: upErr } = await uploadReplacementPhoto(editPhoto, { id: editItem.id, quantity: Number(editForm.quantity) })
      if (upErr) {
        setError(`圖片上傳失敗：${upErr}`)
        setEditSaving(false)
        return
      }
      if (editItem.image_path) await deleteItemPhoto(editItem.image_path)
      imagePath = path
    }

    // 規格補登：依選到的規格帶入 variant id 與規格文字（選「無」則清空）。
    const chosenVariant = editForm.variantId ? variants.find((v) => v.id === Number(editForm.variantId)) : null

    // 安全庫存（低庫存門檻）不在此編輯，統一由「庫存種類設定 → 據點門檻」維護，
    // 這裡不寫 safety_stock，避免兩處不同步。
    const { error: updErr } = await supabase
      .from('supply_item')
      .update({
        quantity: Number(editForm.quantity),
        expiration_date: editItem.stock_type === StockTypes.NoExpiry ? null : editForm.expirationDate || null,
        remark: editForm.remark.trim() || null,
        inventory_item_variant_id: chosenVariant ? chosenVariant.id : null,
        specification: chosenVariant ? chosenVariant.specification : null,
        image_path: imagePath,
        updated_by: profile?.display_name ?? profile?.username ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editItem.id)

    if (updErr) {
      setEditSaving(false)
      setError(updErr.message)
      return
    }

    void logActivity({ action: 'item_edit', category: '資料維護', targetTable: 'supply_item', targetId: editItem.id, locationId: editItem.location_id, summary: `編輯物資「${editItem.item_name}」`, detail: { quantity: Number(editForm.quantity), specification: chosenVariant?.specification ?? null } })
    setEditSaving(false)
    setEditItem(null)
    void load()
  }

  // 篩選條件：關鍵字、據點、種類、庫存分類（分類快速切換 pills）
  const [keyword, setKeyword] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [stockTypeFilter, setStockTypeFilter] = useState('')
  // 狀態篩選：'' 全部 / lowStock 低庫存 / expiringSoon 即將即期 / globalLow 總量不足 / expired 已過期
  const [statusFilter, setStatusFilter] = useState('')
  const [summaryOpen, setSummaryOpen] = useState(true)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [showHidden, setShowHidden] = useState(false) // #4：顯示「數量0超過7天」被隱藏的批次

  // 從物資總覽「查看物資」帶入的據點篩選（?locationId=）
  useEffect(() => {
    const qLocationId = searchParams.get('locationId')
    if (qLocationId) setLocationFilter(qLocationId)
  }, [searchParams])

  async function load() {
    setLoading(true)
    const [itemsRes, locRes, low, globalRes, defRes, varRes, safetyRes] = await Promise.all([
      supabase.from('supply_item').select('*').eq('is_active', true).order('id', { ascending: false }),
      supabase.from('supply_location').select('*').eq('is_active', true).order('id'),
      fetchLowStock(),
      supabase.from('global_low_stock_view').select('category, item_name, specification'),
      supabase.from('inventory_item_definition').select('id, category, item_name'),
      supabase.from('inventory_item_variant').select('id, inventory_item_definition_id, specification, is_active'),
      supabase.from('location_inventory_safety_stock').select('location_id, inventory_item_definition_id, safety_stock'),
    ])
    if (itemsRes.error) setError(itemsRes.error.message)
    setItems((itemsRes.data ?? []) as SupplyItem[])
    setLocations((locRes.data ?? []) as SupplyLocation[])
    setDefinitions((defRes.data ?? []) as { id: number; category: string; item_name: string }[])
    setVariants((varRes.data ?? []) as { id: number; inventory_item_definition_id: number; specification: string | null; is_active: boolean }[])
    setSafetyStocks((safetyRes.data ?? []) as { location_id: number; inventory_item_definition_id: number; safety_stock: number }[])
    setLowStock(low)
    setGlobalLowKeys(
      new Set(
        ((globalRes.data ?? []) as { category: string; item_name: string; specification: string | null }[]).map(
          (g) => `${g.category}|${g.item_name}|${g.specification ?? ''}`
        )
      )
    )
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category))).sort(), [items])

  function isGlobalLow(i: SupplyItem): boolean {
    return globalLowKeys.has(`${i.category}|${i.item_name}|${i.specification ?? ''}`)
  }

  function matchesStatus(i: SupplyItem): boolean {
    if (!statusFilter) return true
    const todayStr = new Date().toISOString().slice(0, 10)
    const in30Str = new Date(Date.now() + EXPIRY_WARNING_DAYS * 86400000).toISOString().slice(0, 10)
    switch (statusFilter) {
      case 'lowStock':
        return isItemLowStock(i, lowStock)
      case 'expiringSoon':
        return i.expiration_date != null && i.expiration_date >= todayStr && i.expiration_date <= in30Str
      case 'globalLow':
        return isGlobalLow(i)
      case 'expired':
        return i.expiration_date != null && i.expiration_date < todayStr
      default:
        return true
    }
  }

  // #4：數量為 0 且超過 7 天未異動（updated_at/建立時間）視為「長期零庫存」，預設隱藏。
  function isLongZero(i: SupplyItem): boolean {
    if (i.quantity !== 0) return false
    const last = i.updated_at ?? i.created_at
    if (!last) return false
    return Date.now() - new Date(last).getTime() > 7 * 86400000
  }

  const baseFiltered = useMemo(() => {
    return items.filter((i) => {
      if (locationFilter && i.location_id !== Number(locationFilter)) return false
      if (categoryFilter && i.category !== categoryFilter) return false
      if (stockTypeFilter && i.stock_type !== stockTypeFilter) return false
      if (!matchesStatus(i)) return false
      if (!withinRange(i.expiration_date, fromDate, toDate)) return false // 有效期限區間（NoExpiry 無效期者，設區間時不列入）
      if (keyword.trim()) {
        const k = keyword.trim().toLowerCase()
        const matches =
          i.item_name.toLowerCase().includes(k) ||
          i.category.toLowerCase().includes(k) ||
          (i.specification ?? '').toLowerCase().includes(k) ||
          (i.remark ?? '').toLowerCase().includes(k)
        if (!matches) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, keyword, locationFilter, categoryFilter, stockTypeFilter, statusFilter, lowStock, globalLowKeys, fromDate, toDate])

  const hiddenCount = useMemo(() => baseFiltered.filter(isLongZero).length, [baseFiltered])
  // showHidden=true 時「只顯示」被隱藏(長期零庫存)的項目，方便單獨檢視；否則顯示一般項目。
  const filteredItems = useMemo(
    () => (showHidden ? baseFiltered.filter((i) => isLongZero(i)) : baseFiltered.filter((i) => !isLongZero(i))),
    [baseFiltered, showHidden]
  )

  // 依物資統計（跨據點加總）：對目前篩選結果依物資名稱分組
  const itemSummary = useMemo<ItemSummaryRow[]>(() => {
    const groups = new Map<
      string,
      { locationIds: Set<number>; totalQuantity: number; unit: string; hasLowStock: boolean; nearestExpirationDate: string | null }
    >()
    for (const item of filteredItems) {
      let g = groups.get(item.item_name)
      if (!g) {
        g = { locationIds: new Set(), totalQuantity: 0, unit: item.unit ?? '', hasLowStock: false, nearestExpirationDate: null }
        groups.set(item.item_name, g)
      }
      g.locationIds.add(item.location_id)
      g.totalQuantity += item.quantity
      if (itemStatus(item, lowStock).label === '低庫存') g.hasLowStock = true
      if (item.expiration_date && (!g.nearestExpirationDate || item.expiration_date < g.nearestExpirationDate)) {
        g.nearestExpirationDate = item.expiration_date
      }
    }
    return Array.from(groups.entries())
      .map(([itemName, g]) => ({
        itemName,
        locationCount: g.locationIds.size,
        totalQuantity: g.totalQuantity,
        unit: g.unit,
        hasLowStock: g.hasLowStock,
        nearestExpirationDate: g.nearestExpirationDate,
      }))
      .sort((a, b) => {
        if (a.nearestExpirationDate && b.nearestExpirationDate) {
          if (a.nearestExpirationDate !== b.nearestExpirationDate) return a.nearestExpirationDate < b.nearestExpirationDate ? -1 : 1
          return b.totalQuantity - a.totalQuantity
        }
        if (a.nearestExpirationDate) return -1
        if (b.nearestExpirationDate) return 1
        return b.totalQuantity - a.totalQuantity
      })
  }, [filteredItems, lowStock])

  function resetFilters() {
    setKeyword('')
    setLocationFilter('')
    setCategoryFilter('')
    setStockTypeFilter('')
    setStatusFilter('')
    setFromDate('')
    setToDate('')
  }

  function locationName(id: number): string {
    return locations.find((l) => l.id === id)?.location_name ?? `#${id}`
  }

  function handleExport() {
    exportToExcel<SupplyItem>('物資清單', '物資清單', [
      { header: '種類', value: (i) => i.category },
      { header: '名稱', value: (i) => i.item_name },
      { header: '規格', value: (i) => i.specification ?? '' },
      { header: '數量', value: (i) => i.quantity, total: true },
      { header: '單位', value: (i) => i.unit ?? '' },
      { header: '庫存分類', value: (i) => stockTypeDisplayName(i.stock_type) },
      { header: '有效期限', value: (i) => i.expiration_date ?? '' },
      { header: '據點', value: (i) => locationName(i.location_id) },
      { header: '安全庫存', value: (i) => thresholdFor(i) },
      { header: '狀態', value: (i) => itemStatus(i, lowStock).label },
      { header: '備註', value: (i) => i.remark ?? '' },
    ], filteredItems)
  }

  async function handleDelete(item: SupplyItem) {
    if (!confirm(`確定刪除「${item.item_name}」這筆物資嗎？`)) return
    const { error } = await supabase.from('supply_item').update({ is_active: false }).eq('id', item.id)
    if (error) {
      setError(error.message)
      return
    }
    if (item.image_path) await deleteItemPhoto(item.image_path)
    void logActivity({ action: 'item_delete', category: '資料維護', targetTable: 'supply_item', targetId: item.id, locationId: item.location_id, summary: `刪除物資「${item.item_name}」` })
    void load()
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>
          <i className="bi bi-box" /> 物資清單
          {!isAdmin && !isCadre && <span className="badge bg-secondary ms-2 align-middle fs-6">唯讀檢視</span>}
          {isCadre && <span className="badge bg-info text-dark ms-2 align-middle fs-6">僅可操作自己據點</span>}
        </h2>
        <div className="d-flex gap-2">
          {/* #4：數量0超過7天的批次預設隱藏；用眼睛切換顯示/隱藏 */}
          <button type="button" className={`btn ${showHidden ? 'btn-warning' : 'btn-outline-secondary'}`} onClick={() => setShowHidden((v) => !v)} title="數量0超過7天的批次">
            <i className={`bi ${showHidden ? 'bi-arrow-left' : 'bi-eye'}`} /> {showHidden ? '返回一般清單' : `顯示已隱藏${hiddenCount > 0 ? `（${hiddenCount}）` : ''}`}
          </button>
          <button className="btn btn-outline-success" onClick={handleExport} disabled={filteredItems.length === 0}>
            <i className="bi bi-file-earmark-excel" /> 匯出 Excel
          </button>
          {(isAdmin || isCadre) && (
            <Link className="btn btn-primary" to="/stock-in">
              <i className="bi bi-box-arrow-in-down" /> 物資入庫
            </Link>
          )}
        </div>
      </div>

      <FlashMessage />
      {error && <div className="alert alert-danger">{error}</div>}

      {showHidden && (
        <div className="alert alert-warning py-2">
          <i className="bi bi-eye" /> 目前只顯示<strong>已隱藏</strong>的項目（數量 0 超過 7 天，共 {hiddenCount} 筆）。按右上「返回一般清單」回到正常檢視。
        </div>
      )}

      {/* 分類快速切換 */}
      <div className="btn-group mb-3" role="group">
        <button
          type="button"
          className={`btn btn-sm ${stockTypeFilter === '' ? 'btn-primary' : 'btn-outline-primary'}`}
          onClick={() => setStockTypeFilter('')}
        >
          全部
        </button>
        {AllStockTypes.map((st) => (
          <button
            key={st}
            type="button"
            className={`btn btn-sm ${stockTypeFilter === st ? 'btn-primary' : 'btn-outline-primary'}`}
            onClick={() => setStockTypeFilter(st)}
          >
            {stockTypeDisplayName(st)}
          </button>
        ))}
      </div>

      {/* 篩選條件 */}
      <div className="card shadow-sm mb-3">
        <div className="card-header bg-light">
          <i className="bi bi-funnel" /> 篩選條件
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-3">
              <label className="form-label">關鍵字</label>
              <input
                className="form-control"
                placeholder="物資名稱、規格、種類、備註"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            <div className="col-md-2">
              <label className="form-label">狀態</label>
              <select className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">全部狀態</option>
                <option value="lowStock">低庫存</option>
                <option value="expiringSoon">即將即期</option>
                <option value="globalLow">總量不足</option>
                <option value="expired">已過期</option>
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label">據點</label>
              <select className="form-select" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                <option value="">全部據點</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.location_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label">種類</label>
              <select className="form-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="">全部種類</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3 d-flex align-items-end">
              <button type="button" className="btn btn-secondary w-100" onClick={resetFilters}>
                <i className="bi bi-arrow-clockwise" /> 重設
              </button>
            </div>
            <div className="col-12">
              <label className="form-label">有效期限區間</label>
              <DateRangeFilter from={fromDate} to={toDate} onFrom={setFromDate} onTo={setToDate} />
              <div className="form-text">依有效期限篩選；「無效期物資」在設定區間時不會列入。</div>
            </div>
          </div>
        </div>
      </div>

      {/* 依物資統計（跨據點加總） */}
      {itemSummary.length > 0 && (
        <div className="card shadow-sm mb-3">
          <div
            className="card-header bg-light d-flex justify-content-between align-items-center"
            style={{ cursor: 'pointer' }}
            onClick={() => setSummaryOpen((v) => !v)}
          >
            <span>
              <i className="bi bi-bar-chart" /> 依物資統計（跨據點加總，共 {itemSummary.length} 種品項）
            </span>
            <i className={`bi bi-chevron-${summaryOpen ? 'up' : 'down'}`} />
          </div>
          {summaryOpen && (
            <div className="card-body">
              <div className="table-responsive">
                <table className="table table-sm table-hover mb-0">
                  <thead>
                    <tr>
                      <th>物資名稱</th>
                      <th>分布據點數</th>
                      <th>總數量</th>
                      <th>最近效期</th>
                      <th>提醒</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemSummary.map((s) => (
                      <tr key={s.itemName}>
                        <td>
                          <strong>{s.itemName}</strong>
                        </td>
                        <td>{s.locationCount}</td>
                        <td>
                          {s.totalQuantity} {s.unit}
                        </td>
                        <td>{s.nearestExpirationDate ?? '-'}</td>
                        <td>{s.hasLowStock && <span className="badge bg-danger">含低庫存</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card shadow-sm">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead className="table-light">
                <tr>
                  <th>照片</th>
                  <th>種類</th>
                  <th>名稱</th>
                  <th>規格</th>
                  <th>數量</th>
                  <th>庫存分類</th>
                  <th>效期</th>
                  <th>據點</th>
                  <th>安全庫存</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={11} className="text-center text-muted py-4">
                      載入中…
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center text-muted py-4">
                      沒有符合條件的物資
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => {
                    const status = itemStatus(item, lowStock)
                    const url = itemPhotoUrl(item.image_path)
                    return (
                      <tr key={item.id}>
                        <td>
                          {url ? (
                            <img
                              src={url}
                              alt={item.item_name}
                              style={{ width: 48, height: 48, objectFit: 'cover', cursor: 'zoom-in' }}
                              className="rounded border"
                              title="點擊放大檢視"
                              onClick={() => setPhotoPreview(item)}
                            />
                          ) : (
                            <i className="bi bi-image text-muted fs-3" />
                          )}
                        </td>
                        <td>{item.category}</td>
                        <td>
                          <strong>{item.item_name}</strong>
                        </td>
                        <td>{item.specification ?? '無'}</td>
                        <td>
                          {item.quantity} {item.unit}
                        </td>
                        <td>
                          <span className={`badge ${stockTypeBadgeClass(item.stock_type)}`}>{stockTypeDisplayName(item.stock_type)}</span>
                        </td>
                        <td>{item.expiration_date ?? '—'}</td>
                        <td>
                          <span className="badge" style={locationColorStyle(item.location_id)}>
                            {locationName(item.location_id)}
                          </span>
                        </td>
                        <td>
                          {thresholdFor(item)} {item.unit}
                        </td>
                        <td>
                          <span className={`badge ${status.badgeClass}`}>{status.label}</span>
                        </td>
                        <td className="text-nowrap">
                          <div className="btn-group btn-group-sm" role="group">
                            <button className="btn btn-info" title="詳細資料" onClick={() => setDetailsItem(item)}>
                              <i className="bi bi-eye" />
                            </button>
                            {/* 舉手：幫主看別據點物資（唯讀）時，可直接向該據點舉手調貨到自己據點。 */}
                            {isCadre && item.location_id !== myLocId && (
                              <button
                                className="btn btn-primary"
                                title="向此據點舉手調貨"
                                onClick={() =>
                                  setRaiseTarget({
                                    category: item.category,
                                    item_name: item.item_name,
                                    specification: item.specification,
                                    unit: item.unit,
                                    locationId: item.location_id,
                                    quantity: item.quantity,
                                  })
                                }
                              >
                                <i className="bi bi-hand-index-thumb" />
                              </button>
                            )}
                            {/* 編輯/轉移/刪除：總管不限；幫主限自己據點；小幫手唯讀。 */}
                            {canOperate(item) && (
                              <button className="btn btn-warning" title="編輯" onClick={() => openEdit(item)}>
                                <i className="bi bi-pencil" />
                              </button>
                            )}
                            {canOperate(item) && (
                              <Link className="btn btn-primary" title="物資轉移" to={`/transfers/create?supplyItemId=${item.id}`}>
                                <i className="bi bi-arrow-left-right" />
                              </Link>
                            )}
                            {canOperate(item) && (
                              <button className="btn btn-danger" title="刪除" onClick={() => void handleDelete(item)}>
                                <i className="bi bi-trash" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3">
            <p className="text-muted mb-0">共 {filteredItems.length} 筆物資</p>
          </div>
        </div>
      </div>

      {/* 放大照片（點縮圖開啟；此處提供下載中文檔名） */}
      {photoPreview && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.75)' }} onClick={() => setPhotoPreview(null)}>
          <div className="modal-dialog modal-lg modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {photoPreview.category}｜{photoPreview.item_name}
                  {photoPreview.specification ? `｜${photoPreview.specification}` : ''}
                </h5>
                <button type="button" className="btn-close" onClick={() => setPhotoPreview(null)} />
              </div>
              <div className="modal-body text-center bg-light">
                <img src={itemPhotoUrl(photoPreview.image_path) ?? ''} alt={photoPreview.item_name} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
              </div>
              <div className="modal-footer">
                <a className="btn btn-outline-success" href={itemPhotoDownloadUrl(photoPreview) ?? '#'} download>
                  <i className="bi bi-download" /> 下載（中文檔名）
                </a>
                <button type="button" className="btn btn-secondary" onClick={() => setPhotoPreview(null)}>
                  關閉
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 詳細資料 */}
      {detailsItem && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-eye" /> 物資詳細資料
                </h5>
                <button type="button" className="btn-close" onClick={() => setDetailsItem(null)} />
              </div>
              <div className="modal-body">
                <dl className="row mb-0">
                  <dt className="col-4">種類</dt>
                  <dd className="col-8">{detailsItem.category}</dd>
                  <dt className="col-4">名稱</dt>
                  <dd className="col-8">{detailsItem.item_name}</dd>
                  <dt className="col-4">規格</dt>
                  <dd className="col-8">{detailsItem.specification ?? '無'}</dd>
                  <dt className="col-4">數量</dt>
                  <dd className="col-8">
                    {detailsItem.quantity} {detailsItem.unit}
                  </dd>
                  <dt className="col-4">庫存分類</dt>
                  <dd className="col-8">{stockTypeDisplayName(detailsItem.stock_type)}</dd>
                  <dt className="col-4">有效期限</dt>
                  <dd className="col-8">{detailsItem.expiration_date ?? '無期限'}</dd>
                  <dt className="col-4">據點</dt>
                  <dd className="col-8">{locationName(detailsItem.location_id)}</dd>
                  <dt className="col-4">安全庫存</dt>
                  <dd className="col-8">
                    {thresholdFor(detailsItem)} {detailsItem.unit}
                  </dd>
                  <dt className="col-4">狀態</dt>
                  <dd className="col-8">
                    <span className={`badge ${itemStatus(detailsItem, lowStock).badgeClass}`}>{itemStatus(detailsItem, lowStock).label}</span>
                  </dd>
                  <dt className="col-4">備註</dt>
                  <dd className="col-8">{detailsItem.remark ?? '—'}</dd>
                </dl>
                {itemPhotoUrl(detailsItem.image_path) && (
                  <div className="text-center mt-3">
                    <img
                      src={itemPhotoUrl(detailsItem.image_path)!}
                      alt=""
                      style={{ maxWidth: '100%', maxHeight: 220, objectFit: 'contain', cursor: 'zoom-in' }}
                      title="點擊放大"
                      onClick={() => {
                        setPhotoPreview(detailsItem)
                        setDetailsItem(null)
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDetailsItem(null)}>
                  關閉
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 編輯物資 */}
      {editItem && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <form onSubmit={handleEditSubmit}>
                <div className="modal-header">
                  <h5 className="modal-title">
                    <i className="bi bi-pencil" /> 編輯物資
                  </h5>
                  <button type="button" className="btn-close" onClick={() => setEditItem(null)} />
                </div>
                <div className="modal-body">
                  <div className="alert alert-light border small mb-3">
                    {editItem.category}｜{editItem.item_name}
                    {editItem.specification ? `｜${editItem.specification}` : ''}｜{locationName(editItem.location_id)}
                  </div>
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label">數量 *</label>
                      <input
                        className="form-control"
                        type="number"
                        min={0}
                        required
                        value={editForm.quantity}
                        onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })}
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">安全庫存（低庫存門檻）</label>
                      <input className="form-control" type="number" value={thresholdFor(editItem)} disabled readOnly />
                      <div className="form-text">此為該據點此品項的低庫存門檻，來自「系統管理 → 庫存種類設定 → 據點門檻」，此處僅顯示、不可修改。</div>
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">規格</label>
                    <select className="form-select" value={editForm.variantId} onChange={(e) => setEditForm({ ...editForm, variantId: e.target.value })}>
                      <option value="">無（未指定）</option>
                      {variantsFor(editItem).map((v) => (
                        <option key={v.id} value={v.id}>{v.specification ?? '無規格'}</option>
                      ))}
                    </select>
                    <div className="form-text">入庫時未指定規格的物資，總管在「庫存種類設定」新增規格後，可在此補上分類。</div>
                  </div>
                  {editItem.stock_type !== StockTypes.NoExpiry && (
                    <div className="mb-3">
                      <label className="form-label">有效期限</label>
                      <DateSelect value={editForm.expirationDate} onChange={(v) => setEditForm({ ...editForm, expirationDate: v })} />
                    </div>
                  )}
                  <div className="mb-3">
                    <label className="form-label">更換圖片</label>
                    <input
                      className="form-control"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => setEditPhoto(e.target.files?.[0] ?? null)}
                    />
                    <div className="form-text">留空表示不更換</div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">備註</label>
                    <textarea className="form-control" rows={2} value={editForm.remark} onChange={(e) => setEditForm({ ...editForm, remark: e.target.value })} />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setEditItem(null)}>
                    取消
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={editSaving}>
                    {editSaving ? '儲存中…' : '儲存變更'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 舉手：向別據點調貨（共用元件） */}
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
