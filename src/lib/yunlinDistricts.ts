// 使用人「所屬鄉鎮」與「身分別」的定義。
//
// 刻意不放進 lib/enums.ts：enums.ts 被多個檔案 import，動它每個人都要重測。
// 這兩組值目前只有物資領用（原出庫）這條切片在用，先獨立成一個檔。
//
// 「區」劃分（分區）由業務端提供，涵蓋雲林縣全部 20 個鄉鎮市（1 市 5 鎮 14 鄉），
// 沒有重複也沒有遺漏。這只是預設值，之後可直接改這張表。

export interface Precinct {
  /** 分區名稱，存進 supply_outbound_log.recipient_precinct */
  name: string
  /** 該區的鄉鎮市，存進 supply_outbound_log.recipient_district */
  townships: string[]
}

export const YunlinPrecincts: Precinct[] = [
  { name: '斗六區', townships: ['斗六市', '林內鄉', '莿桐鄉'] },
  { name: '斗南區', townships: ['斗南鎮', '大埤鄉', '古坑鄉'] },
  { name: '西螺區', townships: ['西螺鎮', '二崙鄉', '崙背鄉'] },
  { name: '虎尾區', townships: ['虎尾鎮', '土庫鎮', '褒忠鄉', '元長鄉'] },
  { name: '台西區', townships: ['東勢鎮', '台西鄉', '麥寮鄉', '四湖鄉'] },
  { name: '北港區', townships: ['北港鎮', '水林鄉', '口湖鄉'] },
]

/** 給定鄉鎮市，反查它屬於哪個區（找不到回傳 null）。 */
export function precinctOfTownship(township: string | null | undefined): string | null {
  if (!township) return null
  return YunlinPrecincts.find((p) => p.townships.includes(township))?.name ?? null
}

// 身分別：比照 enums.ts 的慣例，DB 存英文碼、畫面顯示中文。
export const RecipientIdentities = {
  LowIncome: 'LowIncome',
  MidLowIncome: 'MidLowIncome',
  General: 'General',
  Other: 'Other',
} as const
export type RecipientIdentity = (typeof RecipientIdentities)[keyof typeof RecipientIdentities]
export const AllRecipientIdentities: RecipientIdentity[] = [
  RecipientIdentities.LowIncome,
  RecipientIdentities.MidLowIncome,
  RecipientIdentities.General,
  RecipientIdentities.Other,
]

export function recipientIdentityDisplayName(identity: string | null | undefined): string {
  switch (identity) {
    case RecipientIdentities.LowIncome:
      return '低收入戶'
    case RecipientIdentities.MidLowIncome:
      return '中低收入戶'
    case RecipientIdentities.General:
      return '一般戶'
    case RecipientIdentities.Other:
      return '其他'
    default:
      return identity ?? ''
  }
}

export function recipientIdentityBadgeClass(identity: string | null | undefined): string {
  switch (identity) {
    case RecipientIdentities.LowIncome:
      return 'bg-danger'
    case RecipientIdentities.MidLowIncome:
      return 'bg-warning text-dark'
    case RecipientIdentities.General:
      return 'bg-secondary'
    case RecipientIdentities.Other:
      return 'bg-dark'
    default:
      return 'bg-light text-dark'
  }
}

