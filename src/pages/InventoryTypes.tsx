// Port of InventoryTypeSettingController + Views/InventoryTypeSetting/*.cshtml
// (Index/Create/Edit/Variants/LocationSafety). Admin-only, direct table CRUD
// (RLS-gated) — manages the catalog (InventoryItemDefinition/Variant/
// LocationInventorySafetyStock), not actual stock batches (that's 物資管理).
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { logActivity } from '../lib/activityLog'
import { AllStockTypes, stockTypeDisplayName, stockTypeBadgeClass } from '../lib/enums'
import type { InventoryItemDefinition, InventoryItemVariant, LocationInventorySafetyStock, SupplyLocation } from '../types/db'

type DefForm = {
  id: number | null
  category: string
  item_name: string
  unit: string
  stock_type: string
  is_active: boolean
}

const emptyDefForm: DefForm = {
  id: null,
  category: '',
  item_name: '',
  unit: '',
  stock_type: AllStockTypes[1],
  is_active: true,
}

export function InventoryTypes() {
  const [definitions, setDefinitions] = useState<InventoryItemDefinition[]>([])
  const [variants, setVariants] = useState<InventoryItemVariant[]>([])
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [safetyStocks, setSafetyStocks] = useState<LocationInventorySafetyStock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [stockTypeFilter, setStockTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'inactive'>('')

  const [showDefForm, setShowDefForm] = useState(false)
  const [defForm, setDefForm] = useState<DefForm>(emptyDefForm)
  const [saving, setSaving] = useState(false)

  const [variantEditorFor, setVariantEditorFor] = useState<InventoryItemDefinition | null>(null)
  const [newSpec, setNewSpec] = useState('')
  const [globalSafetyEditorFor, setGlobalSafetyEditorFor] = useState<InventoryItemDefinition | null>(null)
  const [globalSafetyDraft, setGlobalSafetyDraft] = useState<Record<number, string>>({})
  const [globalThresholdDraft, setGlobalThresholdDraft] = useState<Record<number, string>>({})

  const [safetyEditorFor, setSafetyEditorFor] = useState<InventoryItemDefinition | null>(null)
  const [safetyDraft, setSafetyDraft] = useState<Record<number, string>>({})

  async function load() {
    setLoading(true)
    const [defRes, varRes, locRes, safetyRes] = await Promise.all([
      supabase.from('inventory_item_definition').select('*').order('sort_order', { ascending: true }).order('category').order('item_name'),
      supabase.from('inventory_item_variant').select('*'),
      supabase.from('supply_location').select('*').eq('is_active', true).order('id'),
      supabase.from('location_inventory_safety_stock').select('*'),
    ])
    if (defRes.error) setError(defRes.error.message)
    setDefinitions((defRes.data ?? []) as InventoryItemDefinition[])
    setVariants((varRes.data ?? []) as InventoryItemVariant[])
    setLocations((locRes.data ?? []) as SupplyLocation[])
    setSafetyStocks((safetyRes.data ?? []) as LocationInventorySafetyStock[])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(() => {
    return definitions.filter((d) => {
      if (stockTypeFilter && d.stock_type !== stockTypeFilter) return false
      if (statusFilter && (statusFilter === 'active' ? !d.is_active : d.is_active)) return false
      if (keyword.trim()) {
        const k = keyword.trim().toLowerCase()
        if (!d.category.toLowerCase().includes(k) && !d.item_name.toLowerCase().includes(k)) return false
      }
      return true
    })
  }, [definitions, keyword, stockTypeFilter, statusFilter])

  function resetFilters() {
    setKeyword('')
    setStockTypeFilter('')
    setStatusFilter('')
  }

  // #3：拖拉排序（僅在未套用篩選時開放，避免只重排子集造成混亂）。
  const canReorder = !keyword.trim() && !stockTypeFilter && !statusFilter
  const [dragId, setDragId] = useState<number | null>(null)
  async function persistOrder(arr: InventoryItemDefinition[]) {
    await Promise.all(arr.map((d, i) => supabase.from('inventory_item_definition').update({ sort_order: i }).eq('id', d.id)))
    void logActivity({ action: 'inventory_reorder', category: '資料維護', targetTable: 'inventory_item_definition', summary: '調整庫存種類顯示順序' })
  }
  function handleDropOn(targetId: number) {
    if (dragId == null || dragId === targetId) { setDragId(null); return }
    setDefinitions((prev) => {
      const arr = [...prev]
      const from = arr.findIndex((d) => d.id === dragId)
      const to = arr.findIndex((d) => d.id === targetId)
      if (from < 0 || to < 0) return prev
      const [moved] = arr.splice(from, 1)
      arr.splice(to, 0, moved)
      void persistOrder(arr)
      return arr
    })
    setDragId(null)
  }

  function activeVariantCount(defId: number): number {
    return variants.filter((v) => v.inventory_item_definition_id === defId && v.is_active).length
  }

  function safetyStockCount(defId: number): number {
    return safetyStocks.filter((s) => s.inventory_item_definition_id === defId).length
  }

  function globalSafetyConfiguredCount(defId: number): number {
    // 有設門檻（global_threshold > 0）才算「已開啟監控」。
    return variants.filter((v) => v.inventory_item_definition_id === defId && v.is_active && v.global_threshold > 0).length
  }

  function openCreate() {
    setDefForm(emptyDefForm)
    setShowDefForm(true)
  }

  function openEdit(def: InventoryItemDefinition) {
    setDefForm({
      id: def.id,
      category: def.category,
      item_name: def.item_name,
      unit: def.unit,
      stock_type: def.stock_type,
      is_active: def.is_active,
    })
    setShowDefForm(true)
  }

  async function handleDefSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const payload = {
      category: defForm.category.trim(),
      item_name: defForm.item_name.trim(),
      unit: defForm.unit.trim(),
      stock_type: defForm.stock_type,
      is_active: defForm.is_active,
      updated_at: new Date().toISOString(),
    }

    const result = defForm.id
      ? await supabase.from('inventory_item_definition').update(payload).eq('id', defForm.id)
      : await supabase.from('inventory_item_definition').insert(payload)

    setSaving(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    setShowDefForm(false)
    void load()
  }

  async function handleDisableDef(def: InventoryItemDefinition) {
    if (!confirm(`確定停用「${def.category}｜${def.item_name}」嗎？`)) return
    const { error } = await supabase
      .from('inventory_item_definition')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', def.id)
    if (error) {
      setError(error.message)
      return
    }
    void load()
  }

  async function handleAddVariant() {
    if (!variantEditorFor) return
    // 防呆：一定要輸入規格文字才能新增，不再自動帶入「無規格」。
    const spec = newSpec.trim()
    if (!spec) {
      alert('請先輸入規格文字才能新增。')
      return
    }
    // 同一品項下避免重複規格。
    const dup = variants.some(
      (v) => v.inventory_item_definition_id === variantEditorFor.id && (v.specification ?? '').trim() === spec
    )
    if (dup) {
      alert(`規格「${spec}」已存在。`)
      return
    }
    const { error } = await supabase.from('inventory_item_variant').insert({
      inventory_item_definition_id: variantEditorFor.id,
      specification: spec,
      global_safety_stock: 0,
      global_threshold: 0,
      is_active: true,
    })
    if (error) {
      setError(error.message)
      return
    }
    setNewSpec('')
    void load()
  }

  // 編輯規格名稱（修正打錯的文字）。
  async function handleRenameVariant(variant: InventoryItemVariant) {
    const next = prompt('修改規格名稱：', variant.specification ?? '')
    if (next === null) return // 取消
    const spec = next.trim()
    if (!spec) {
      alert('規格名稱不可空白。')
      return
    }
    if (spec === (variant.specification ?? '').trim()) return
    const dup = variants.some(
      (v) => v.id !== variant.id && v.inventory_item_definition_id === variant.inventory_item_definition_id && (v.specification ?? '').trim() === spec
    )
    if (dup) {
      alert(`規格「${spec}」已存在。`)
      return
    }
    const { error } = await supabase
      .from('inventory_item_variant')
      .update({ specification: spec, updated_at: new Date().toISOString() })
      .eq('id', variant.id)
    if (error) {
      setError(error.message)
      return
    }
    void load()
  }

  // 刪除規格（給新增錯的用）。若已被物資使用則會有外鍵限制，改提示用停用。
  async function handleDeleteVariant(variant: InventoryItemVariant) {
    if (!confirm(`確定刪除規格「${variant.specification ?? '無規格'}」嗎？此動作無法復原。`)) return
    // 先檢查是否已有物資引用此規格，有的話不可刪除。
    const { count } = await supabase
      .from('supply_item')
      .select('id', { count: 'exact', head: true })
      .eq('inventory_item_variant_id', variant.id)
    if ((count ?? 0) > 0) {
      alert(`此規格已被 ${count} 筆物資使用，無法刪除。請改用「停用」。`)
      return
    }
    const { error } = await supabase.from('inventory_item_variant').delete().eq('id', variant.id)
    if (error) {
      alert(`刪除失敗（可能已被物資使用）：${error.message}。請改用「停用」。`)
      return
    }
    void load()
  }

  function openGlobalSafetyEditor(def: InventoryItemDefinition) {
    const draft: Record<number, string> = {}
    const thresholdDraft: Record<number, string> = {}
    for (const variant of variants.filter((v) => v.inventory_item_definition_id === def.id && v.is_active)) {
      draft[variant.id] = (variant.global_safety_stock ?? 0).toString()
      thresholdDraft[variant.id] = (variant.global_threshold ?? 0).toString()
    }
    setGlobalSafetyDraft(draft)
    setGlobalThresholdDraft(thresholdDraft)
    setGlobalSafetyEditorFor(def)
  }

  async function handleSaveGlobalSafety() {
    if (!globalSafetyEditorFor) return
    const targetVariants = variants.filter((v) => v.inventory_item_definition_id === globalSafetyEditorFor.id && v.is_active)
    if (targetVariants.length === 0) {
      setError('請先新增至少一個規格，才能設定總量安全庫存。')
      return
    }
    setSaving(true)
    setError(null)
    const updates = await Promise.all(
      targetVariants.map((variant) =>
        supabase
          .from('inventory_item_variant')
          .update({
            global_safety_stock: Math.max(0, Number(globalSafetyDraft[variant.id] ?? 0) || 0),
            global_threshold: Math.max(0, Number(globalThresholdDraft[variant.id] ?? 0) || 0),
            updated_at: new Date().toISOString(),
          })
          .eq('id', variant.id)
      )
    )
    setSaving(false)
    const failed = updates.find((result) => result.error)
    if (failed?.error) {
      setError(failed.error.message)
      return
    }
    void logActivity({ action: 'global_threshold_update', category: '資料維護', targetTable: 'inventory_item_variant', targetId: globalSafetyEditorFor.id, summary: `設定總量門檻：${globalSafetyEditorFor.category}｜${globalSafetyEditorFor.item_name}` })
    setGlobalSafetyEditorFor(null)
    void load()
  }

  async function handleEnableDef(def: InventoryItemDefinition) {
    const { error } = await supabase
      .from('inventory_item_definition')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', def.id)
    if (error) {
      setError(error.message)
      return
    }
    void load()
  }

  async function handleDisableVariant(variant: InventoryItemVariant) {
    const { error } = await supabase
      .from('inventory_item_variant')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', variant.id)
    if (error) {
      setError(error.message)
      return
    }
    void load()
  }

  async function handleEnableVariant(variant: InventoryItemVariant) {
    const { error } = await supabase
      .from('inventory_item_variant')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', variant.id)
    if (error) {
      setError(error.message)
      return
    }
    void load()
  }

  function openSafetyEditor(def: InventoryItemDefinition) {
    const draft: Record<number, string> = {}
    for (const loc of locations) {
      const row = safetyStocks.find((s) => s.location_id === loc.id && s.inventory_item_definition_id === def.id)
      draft[loc.id] = (row?.safety_stock ?? 0).toString()
    }
    setSafetyDraft(draft)
    setSafetyEditorFor(def)
  }

  async function handleSaveSafety() {
    if (!safetyEditorFor) return
    setSaving(true)
    for (const loc of locations) {
      const value = Number(safetyDraft[loc.id] ?? 0)
      const existing = safetyStocks.find(
        (s) => s.location_id === loc.id && s.inventory_item_definition_id === safetyEditorFor.id
      )
      if (existing) {
        await supabase
          .from('location_inventory_safety_stock')
          .update({ safety_stock: value, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
      } else {
        await supabase.from('location_inventory_safety_stock').insert({
          location_id: loc.id,
          inventory_item_definition_id: safetyEditorFor.id,
          safety_stock: value,
        })
      }
    }
    setSaving(false)
    void logActivity({ action: 'safety_threshold_update', category: '資料維護', targetTable: 'location_inventory_safety_stock', targetId: safetyEditorFor.id, summary: `設定據點門檻：${safetyEditorFor.category}｜${safetyEditorFor.item_name}` })
    setSafetyEditorFor(null)
    void load()
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h2>
            <i className="bi bi-card-list" /> 庫存種類設定
          </h2>
          <p className="text-muted mb-0">據點門檻依物資種類與名稱合計；全系統安全總量則依規格分開設定與計算。</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <i className="bi bi-plus-circle" /> 新增種類
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card shadow-sm mb-3">
        <div className="card-header bg-light">
          <i className="bi bi-funnel" /> 篩選條件
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-5">
              <label className="form-label">關鍵字</label>
              <input
                className="form-control"
                placeholder="搜尋物資種類或名稱"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            <div className="col-md-3">
              <label className="form-label">庫存分類</label>
              <select className="form-select" value={stockTypeFilter} onChange={(e) => setStockTypeFilter(e.target.value)}>
                <option value="">全部分類</option>
                {AllStockTypes.map((st) => (
                  <option key={st} value={st}>
                    {stockTypeDisplayName(st)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">狀態</label>
              <select
                className="form-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as '' | 'active' | 'inactive')}
              >
                <option value="">全部</option>
                <option value="active">啟用</option>
                <option value="inactive">停用</option>
              </select>
            </div>
            <div className="col-md-1 d-flex align-items-end">
              <button type="button" className="btn btn-secondary w-100" onClick={resetFilters} title="重設">
                <i className="bi bi-arrow-clockwise" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card shadow-sm">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th className="col-min" title="拖拉調整順序"><i className="bi bi-arrows-move" /></th>
                  <th>物資種類</th>
                  <th>物資名稱</th>
                  <th>庫存分類</th>
                  <th>最小單位</th>
                  <th>規格數</th>
                  <th>總量安全庫存</th>
                  <th>據點門檻</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="text-center text-muted py-4">
                      載入中…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center text-muted py-4">
                      尚未建立庫存種類
                    </td>
                  </tr>
                ) : (
                  filtered.map((def) => (
                    <tr
                      key={def.id}
                      draggable={canReorder}
                      onDragStart={() => canReorder && setDragId(def.id)}
                      onDragOver={(e) => { if (canReorder) e.preventDefault() }}
                      onDrop={() => canReorder && handleDropOn(def.id)}
                      style={canReorder && dragId === def.id ? { opacity: 0.5 } : undefined}
                    >
                      <td className="col-min text-center text-muted" style={{ cursor: canReorder ? 'grab' : 'not-allowed' }} title={canReorder ? '拖拉調整順序' : '清除篩選後才能拖拉排序'}>
                        <i className="bi bi-grip-vertical" />
                      </td>
                      <td>{def.category}</td>
                      <td>
                        <strong>{def.item_name}</strong>
                      </td>
                      <td>
                        <span className={`badge ${stockTypeBadgeClass(def.stock_type)}`}>
                          {stockTypeDisplayName(def.stock_type)}
                        </span>
                      </td>
                      <td>{def.unit}</td>
                      <td>{activeVariantCount(def.id)}</td>
                      <td>{globalSafetyConfiguredCount(def.id) > 0 ? `已設定 ${globalSafetyConfiguredCount(def.id)} 個規格` : '未設定'}</td>
                      <td>{safetyStockCount(def.id)} 筆</td>
                      <td>
                        <span className={`badge ${def.is_active ? 'bg-success' : 'bg-secondary'}`}>
                          {def.is_active ? '啟用' : '停用'}
                        </span>
                      </td>
                      <td className="text-nowrap">
                        <button className="btn btn-sm btn-outline-primary me-1" onClick={() => openEdit(def)}>
                          編輯
                        </button>
                        <button className="btn btn-sm btn-outline-info me-1" onClick={() => setVariantEditorFor(def)}>
                          規格
                        </button>
                        <button className="btn btn-sm btn-outline-warning me-1" onClick={() => openGlobalSafetyEditor(def)}>
                          總量門檻
                        </button>
                        <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => openSafetyEditor(def)}>
                          據點門檻
                        </button>
                        {def.is_active && (
                          <button className="btn btn-sm btn-outline-danger" onClick={() => void handleDisableDef(def)}>
                            停用
                          </button>
                        )}
                        {!def.is_active && (
                          <button className="btn btn-sm btn-outline-success" onClick={() => void handleEnableDef(def)}>
                            啟用
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

      {/* 新增/編輯種類 */}
      {showDefForm && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <form onSubmit={handleDefSubmit}>
                <div className="modal-header">
                  <h5 className="modal-title">{defForm.id ? '編輯庫存種類' : '新增庫存種類'}</h5>
                  <button type="button" className="btn-close" onClick={() => setShowDefForm(false)} />
                </div>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label">物資種類 *</label>
                    <input
                      className="form-control"
                      required
                      value={defForm.category}
                      onChange={(e) => setDefForm({ ...defForm, category: e.target.value })}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">物資名稱 *</label>
                    <input
                      className="form-control"
                      required
                      value={defForm.item_name}
                      onChange={(e) => setDefForm({ ...defForm, item_name: e.target.value })}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">最小單位 *</label>
                    <input
                      className="form-control"
                      required
                      value={defForm.unit}
                      onChange={(e) => setDefForm({ ...defForm, unit: e.target.value })}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">庫存分類 *</label>
                    <select
                      className="form-select"
                      value={defForm.stock_type}
                      onChange={(e) => setDefForm({ ...defForm, stock_type: e.target.value })}
                    >
                      {AllStockTypes.map((st) => (
                        <option key={st} value={st}>
                          {stockTypeDisplayName(st)}
                        </option>
                      ))}
                    </select>
                  </div>
                  {defForm.id && (
                    <div className="form-check">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={defForm.is_active}
                        onChange={(e) => setDefForm({ ...defForm, is_active: e.target.checked })}
                      />
                      <label className="form-check-label">啟用，供新增物資時選擇</label>
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowDefForm(false)}>
                    取消
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? '儲存中…' : '儲存'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 全系統安全總量：每個規格獨立設定，所有據點同規格庫存加總後判斷。 */}
      {globalSafetyEditorFor && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  全系統安全總量 — {globalSafetyEditorFor.category}｜{globalSafetyEditorFor.item_name}
                </h5>
                <button type="button" className="btn-close" onClick={() => setGlobalSafetyEditorFor(null)} />
              </div>
              <div className="modal-body">
                <div className="alert alert-warning small mb-3">
                  系統會加總所有據點的同一規格庫存。<strong>募資啟動條件：當前總庫存 &lt; 門檻 × 0.9</strong>。
                  門檻設為 0 表示不監控該規格。
                </div>
                <table className="table align-middle mb-0">
                  <thead>
                    <tr>
                      <th>規格</th>
                      <th>門檻（{globalSafetyEditorFor.unit}）</th>
                      <th>安全庫存量（{globalSafetyEditorFor.unit}）</th>
                      <th className="text-muted small">觸發點</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variants.filter((v) => v.inventory_item_definition_id === globalSafetyEditorFor.id && v.is_active).map((variant) => {
                      // 觸發點＝門檻 × 0.9（當前總庫存低於此值即啟動募資）。
                      const trigger = Math.floor((Number(globalThresholdDraft[variant.id] ?? 0) || 0) * 0.9)
                      const monitored = (Number(globalThresholdDraft[variant.id] ?? 0) || 0) > 0
                      return (
                        <tr key={variant.id}>
                          <td>{variant.specification ?? '無規格'}</td>
                          <td>
                            <input
                              className="form-control"
                              type="number"
                              min={0}
                              value={globalThresholdDraft[variant.id] ?? '0'}
                              onChange={(e) => setGlobalThresholdDraft({ ...globalThresholdDraft, [variant.id]: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              className="form-control"
                              type="number"
                              min={0}
                              value={globalSafetyDraft[variant.id] ?? '0'}
                              onChange={(e) => setGlobalSafetyDraft({ ...globalSafetyDraft, [variant.id]: e.target.value })}
                            />
                          </td>
                          <td className="small">
                            {monitored ? <>低於 <strong>{trigger}</strong> 時募資</> : <span className="text-muted">未監控</span>}
                          </td>
                        </tr>
                      )
                    })}
                    {variants.filter((v) => v.inventory_item_definition_id === globalSafetyEditorFor.id && v.is_active).length === 0 && (
                      <tr><td colSpan={4} className="text-muted text-center py-4">請先在「規格」中新增規格。</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setGlobalSafetyEditorFor(null)}>取消</button>
                <button className="btn btn-primary" disabled={saving} onClick={() => void handleSaveGlobalSafety()}>
                  {saving ? '儲存中…' : '儲存總量門檻'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 規格管理 */}
      {variantEditorFor && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  規格設定 — {variantEditorFor.category}｜{variantEditorFor.item_name}（最小單位：{variantEditorFor.unit}）
                </h5>
                <button type="button" className="btn-close" onClick={() => setVariantEditorFor(null)} />
              </div>
              <div className="modal-body">
                <div className="input-group mb-3">
                  <input
                    className="form-control"
                    placeholder="輸入新規格（必填）"
                    value={newSpec}
                    onChange={(e) => setNewSpec(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAddVariant() } }}
                  />
                  <button className="btn btn-primary" disabled={!newSpec.trim()} onClick={() => void handleAddVariant()}>
                    <i className="bi bi-plus-circle" /> 新增規格
                  </button>
                </div>
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>規格</th>
                      <th>狀態</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variants
                      .filter((v) => v.inventory_item_definition_id === variantEditorFor.id)
                      .map((v) => (
                        <tr key={v.id}>
                          <td>{v.specification ?? '無規格'}</td>
                          <td>{v.is_active ? '啟用' : '停用'}</td>
                          <td>
                            <div className="d-flex gap-1 flex-wrap">
                              <button className="btn btn-sm btn-outline-primary" title="編輯規格名稱" onClick={() => void handleRenameVariant(v)}>
                                編輯
                              </button>
                              {v.is_active ? (
                                <button className="btn btn-sm btn-outline-danger" onClick={() => void handleDisableVariant(v)}>
                                  停用
                                </button>
                              ) : (
                                <button className="btn btn-sm btn-outline-success" onClick={() => void handleEnableVariant(v)}>
                                  啟用
                                </button>
                              )}
                              <button className="btn btn-sm btn-danger" title="刪除此規格（新增錯誤時用；已被物資使用者無法刪除）" onClick={() => void handleDeleteVariant(v)}>
                                刪除
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setVariantEditorFor(null)}>
                  關閉
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 據點門檻 */}
      {safetyEditorFor && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  各據點安全庫存 — {safetyEditorFor.category}｜{safetyEditorFor.item_name}
                </h5>
                <button type="button" className="btn-close" onClick={() => setSafetyEditorFor(null)} />
              </div>
              <div className="modal-body">
                <table className="table">
                  <thead>
                    <tr>
                      <th>據點</th>
                      <th>
                        安全庫存（{safetyEditorFor.unit}）
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {locations.map((loc) => (
                      <tr key={loc.id}>
                        <td>{loc.location_name}</td>
                        <td>
                          <input
                            className="form-control"
                            type="number"
                            min={0}
                            value={safetyDraft[loc.id] ?? '0'}
                            onChange={(e) => setSafetyDraft({ ...safetyDraft, [loc.id]: e.target.value })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setSafetyEditorFor(null)}>
                  取消
                </button>
                <button className="btn btn-primary" disabled={saving} onClick={() => void handleSaveSafety()}>
                  {saving ? '儲存中…' : '儲存據點門檻'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
