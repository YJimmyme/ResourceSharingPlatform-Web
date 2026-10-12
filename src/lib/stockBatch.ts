// 出庫／捐贈／報廢共用的「庫存批次」判讀邏輯：效期狀態、下拉文字、即期清單查詢。
// 與 components/StockBatchPicker.tsx 分開放，是因為那支只放元件（混在一起會讓
// Vite 的 fast refresh 失效 —— 見 oxlint 的 react/only-export-components）。
import { supabase } from './supabaseClient'
import type { SupplyItem } from '../types/db'

// 與物資總覽、物資清單的「即將過期」門檻一致。
export const EXPIRY_WARNING_DAYS = 10

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// 只有即期與已過期需要提醒；一般效期回傳 null（不加註記）。
export function expiryAlert(item: SupplyItem): { label: string; badgeClass: string } | null {
  if (!item.expiration_date) return null
  const days = Math.ceil((new Date(`${item.expiration_date}T00:00:00`).getTime() - startOfToday()) / 86400000)
  if (days < 0) return { label: '已過期', badgeClass: 'bg-danger' }
  if (days <= EXPIRY_WARNING_DAYS) return { label: '即將過期', badgeClass: 'bg-warning text-dark' }
  return null
}

export function isExpired(item: SupplyItem): boolean {
  return expiryAlert(item)?.label === '已過期'
}

// 規格／批次下拉的文字：規格在前，接現有數量與效期，即期／已過期直接標在選項上。
export function batchLabel(item: SupplyItem): string {
  const spec = item.specification?.trim() || '無'
  const alert = expiryAlert(item)
  const expiry = item.expiration_date
    ? `（效期 ${item.expiration_date}${alert ? ` ${alert.label}` : ''}）`
    : '（無效期）'
  return `${spec} － 現有 ${item.quantity} ${item.unit ?? ''}${expiry}`
}

// 即期／已過期快選清單。非管理員只看自己據點：supply_item 另有一條 RLS 放行
// 「轉入本據點的來源批次」，那些不是自己能處理的東西，不該出現在快選裡。
export async function fetchExpiringItems(scopeLocationId: number | null): Promise<SupplyItem[]> {
  const limitDate = new Date(Date.now() + EXPIRY_WARNING_DAYS * 86400000).toISOString().slice(0, 10)
  let query = supabase
    .from('supply_item')
    .select('*')
    .eq('is_active', true)
    .gt('quantity', 0)
    .not('expiration_date', 'is', null)
    .lte('expiration_date', limitDate)
    .order('expiration_date', { ascending: true })
    .limit(20)
  if (scopeLocationId != null) query = query.eq('location_id', scopeLocationId)
  const { data } = await query
  return (data ?? []) as SupplyItem[]
}
