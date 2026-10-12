// 物資總覽四種狀態的統一配色（分工單 p.9「色塊改色」）。
// 抽成單一來源，Dashboard 的色塊、篩選元件（p.3）與共用狀態版面（p.4）都引用這裡，
// 之後要改色只改一處。
//   藍   據點低庫存 (locationLowStock)
//   紅   總量不足   (globalLowStock)
//   黃   即將過期   (expiringSoon)
//   鐵灰 已過期     (expired)
import type { CSSProperties } from 'react'

export type DashboardStatusKey = 'locationLowStock' | 'globalLowStock' | 'expiringSoon' | 'expired'

export interface StatusColor {
  label: string
  bg: string // 背景色
  text: string // 對比文字色
  icon: string // bootstrap-icons class
}

// 配色比照使用者附件（淺色系色塊 + 深色文字，四色皆用黑字）。
export const statusColorMap: Record<DashboardStatusKey, StatusColor> = {
  locationLowStock: { label: '據點低庫存', bg: '#4FC3F7', text: '#212529', icon: 'bi-exclamation-triangle-fill' }, // 天藍
  globalLowStock: { label: '總量不足／啟動募資', bg: '#F58787', text: '#212529', icon: 'bi-globe' }, // 珊瑚紅
  expiringSoon: { label: '即將過期', bg: '#FBC02D', text: '#212529', icon: 'bi-clock-fill' }, // 金黃
  expired: { label: '已過期', bg: '#C4C4C4', text: '#212529', icon: 'bi-x-circle-fill' }, // 淺灰
}

export const AllDashboardStatuses: DashboardStatusKey[] = ['locationLowStock', 'globalLowStock', 'expiringSoon', 'expired']

// 供「色塊」用的內嵌樣式（背景＋文字色）。
export function statusCardStyle(key: DashboardStatusKey): CSSProperties {
  const c = statusColorMap[key]
  return { backgroundColor: c.bg, color: c.text }
}
