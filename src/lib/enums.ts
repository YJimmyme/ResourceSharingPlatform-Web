// TS port of Models/Roles.cs, StockTypes.cs, DisposalReasons.cs, TransferStatuses.cs,
// AIStockInInputTypes.cs from the .NET app. Values (the DB-stored strings) are unchanged;
// only the display-name/badge-class helpers are re-expressed for a Tailwind-less plain
// CSS class scheme (Bootstrap classes kept 1:1 since the rewrite still uses Bootstrap-style
// utility classes for now — swap if the design system changes later).

export const Roles = {
  Admin: 'Admin',
  Cadre: 'Cadre',
  SocialWorker: 'SocialWorker',
} as const
export type Role = (typeof Roles)[keyof typeof Roles]
export const AllRoles: Role[] = [Roles.Admin, Roles.Cadre, Roles.SocialWorker]
export function roleDisplayName(role: string | null | undefined): string {
  switch (role) {
    case Roles.Admin:
      return '總管'
    case Roles.Cadre:
      return '幫主'
    case Roles.SocialWorker:
      return '物資小幫手'
    default:
      return role ?? ''
  }
}

export const StockTypes = {
  NoExpiry: 'NoExpiry',
  HasExpiry: 'HasExpiry',
  Frozen: 'Frozen',
} as const
export type StockType = (typeof StockTypes)[keyof typeof StockTypes]
export const AllStockTypes: StockType[] = [StockTypes.NoExpiry, StockTypes.HasExpiry, StockTypes.Frozen]
export function stockTypeDisplayName(stockType: string | null | undefined): string {
  switch (stockType) {
    case StockTypes.NoExpiry:
      return '無效期物資'
    case StockTypes.HasExpiry:
      return '有效期物資'
    case StockTypes.Frozen:
      return '冷凍食品'
    default:
      return stockType ?? ''
  }
}
export function stockTypeBadgeClass(stockType: string | null | undefined): string {
  switch (stockType) {
    case StockTypes.NoExpiry:
      return 'bg-primary'
    case StockTypes.HasExpiry:
      return 'bg-success'
    case StockTypes.Frozen:
      return 'bg-info text-dark'
    default:
      return 'bg-secondary'
  }
}

export const DisposalReasons = {
  Expired: 'Expired',
  Damaged: 'Damaged',
  Lost: 'Lost',
  Other: 'Other',
} as const
export type DisposalReason = (typeof DisposalReasons)[keyof typeof DisposalReasons]
export const AllDisposalReasons: DisposalReason[] = [
  DisposalReasons.Expired,
  DisposalReasons.Damaged,
  DisposalReasons.Lost,
  DisposalReasons.Other,
]
export function disposalReasonDisplayName(reason: string | null | undefined): string {
  switch (reason) {
    case DisposalReasons.Expired:
      return '過期'
    case DisposalReasons.Damaged:
      return '損壞'
    case DisposalReasons.Lost:
      return '遺失'
    case DisposalReasons.Other:
      return '其他'
    default:
      return reason ?? ''
  }
}
export function disposalReasonBadgeClass(reason: string | null | undefined): string {
  switch (reason) {
    case DisposalReasons.Expired:
      return 'bg-danger'
    case DisposalReasons.Damaged:
      return 'bg-warning text-dark'
    case DisposalReasons.Lost:
      return 'bg-secondary'
    case DisposalReasons.Other:
      return 'bg-dark'
    default:
      return 'bg-secondary'
  }
}

export const TransferStatuses = {
  Pending: 'Pending',
  Confirmed: 'Confirmed',
  Cancelled: 'Cancelled',
} as const
export type TransferStatus = (typeof TransferStatuses)[keyof typeof TransferStatuses]
export function transferStatusDisplayName(status: string | null | undefined): string {
  switch (status) {
    case TransferStatuses.Pending:
      return '待確認'
    case TransferStatuses.Confirmed:
      return '已確認'
    case TransferStatuses.Cancelled:
      return '已取消'
    default:
      return status ?? ''
  }
}
export function transferStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case TransferStatuses.Pending:
      return 'bg-warning text-dark'
    case TransferStatuses.Confirmed:
      return 'bg-success'
    case TransferStatuses.Cancelled:
      return 'bg-secondary'
    default:
      return 'bg-light text-dark'
  }
}

export const AIStockInInputTypes = {
  Image: 'Image',
  Text: 'Text',
} as const
export type AIStockInInputType = (typeof AIStockInInputTypes)[keyof typeof AIStockInInputTypes]
export function aiStockInInputTypeDisplayName(inputType: string | null | undefined): string {
  switch (inputType) {
    case AIStockInInputTypes.Image:
      return '照片辨識'
    case AIStockInInputTypes.Text:
      return '文字描述'
    default:
      return inputType ?? ''
  }
}
