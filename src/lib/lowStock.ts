// 低庫存的「單一判斷來源」（分工單 p.1 Bug：物資總覽與物資清單各自判斷、會不同步）。
//
// 正式規則（與 location_low_stock_view 一致）：某「據點 × 品項定義」的**該據點總量**
// ≤ 該據點設定的安全庫存門檻（location_inventory_safety_stock，只算門檻 > 0）時，
// 視為低庫存。單筆 supply_item 是否低庫存 = 它的 (據點, 解析後的品項定義) 是否落在
// 這個低庫存集合裡。
//
// 為什麼不用 supply_item.safety_stock 逐列判斷：那是入庫當下複製的快照，門檻改了不會
// 更新、且無法反映「同據點同品項多批加總」，正是兩頁不同步的根因。改成兩頁都查這裡。
import { supabase } from './supabaseClient'

export interface LowStockData {
  /** `${location_id}:${definition_id}` 的低庫存集合 */
  lowPairs: Set<string>
  /** supply_item.id -> 解析後的品項定義 id */
  resolvedByItemId: Map<number, number>
}

export const emptyLowStock: LowStockData = { lowPairs: new Set(), resolvedByItemId: new Map() }

export async function fetchLowStock(): Promise<LowStockData> {
  const [lowRes, resolvedRes] = await Promise.all([
    supabase.from('location_low_stock_view').select('location_id, inventory_item_definition_id'),
    supabase.from('supply_item_resolved').select('id, location_id, resolved_definition_id'),
  ])
  const lowPairs = new Set<string>()
  for (const r of (lowRes.data ?? []) as { location_id: number; inventory_item_definition_id: number }[]) {
    lowPairs.add(`${r.location_id}:${r.inventory_item_definition_id}`)
  }
  const resolvedByItemId = new Map<number, number>()
  for (const r of (resolvedRes.data ?? []) as { id: number; resolved_definition_id: number | null }[]) {
    if (r.resolved_definition_id != null) resolvedByItemId.set(r.id, r.resolved_definition_id)
  }
  return { lowPairs, resolvedByItemId }
}

/** 單筆物資是否為低庫存（用統一來源判斷）。 */
export function isItemLowStock(item: { id: number; location_id: number }, data: LowStockData): boolean {
  const defId = data.resolvedByItemId.get(item.id)
  if (defId == null) return false
  return data.lowPairs.has(`${item.location_id}:${defId}`)
}
