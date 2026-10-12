// Hand-written types for the tables the app touches early on. Expand as more
// screens are built; consider swapping to `supabase gen types typescript` once
// the schema stabilizes.

import type { Role } from '../lib/enums'

export interface Profile {
  id: string
  username: string
  display_name: string | null
  role_name: Role
  location_id: number | null
  is_active: boolean
  password_changed_at: string | null
  created_at: string
  updated_at: string | null
}

export interface SupplyLocation {
  id: number
  location_name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  contact_person: string | null
  phone: string | null
  is_active: boolean
  created_at: string
  updated_at: string | null
}

export interface InventoryItemDefinition {
  id: number
  category: string
  item_name: string
  unit: string
  global_safety_stock: number
  stock_type: string
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string | null
}

export interface InventoryItemVariant {
  id: number
  inventory_item_definition_id: number
  specification: string | null
  global_safety_stock: number // 安全庫存量（保留量）
  global_threshold: number // 募資門檻；當前總庫存 < 門檻 − 安全庫存量 時列為總量不足／啟動募資
  is_active: boolean
  created_at: string
  updated_at: string | null
}

export interface LocationInventorySafetyStock {
  id: number
  location_id: number
  inventory_item_definition_id: number
  safety_stock: number
  created_at: string
  updated_at: string | null
}

export interface SupplyOutboundLog {
  id: number
  supply_item_id: number
  location_id: number
  outbound_quantity: number
  recipient_name: string
  recipient_contact: string | null
  operator: string | null
  outbound_time: string
  remark: string | null
  // 批次出庫與使用人資料擴充；既有單筆紀錄可為 null。
  batch_id: string | null
  recipient_precinct: string | null
  recipient_district: string | null
  recipient_identity: string | null
  // 取消出庫保留原紀錄，並標記取消資訊。
  is_cancelled: boolean
  cancelled_at: string | null
  cancelled_by: string | null
  cancel_reason: string | null
}

export interface SupplyDonationLog {
  id: number
  supply_item_id: number
  location_id: number
  donation_quantity: number
  donor_name: string
  donor_contact: string | null
  operator: string | null
  donation_time: string
  remark: string | null
}

// donation_source_view：物資捐贈 + 物資入庫(有捐贈人) 的統一來源。
export interface DonationSource {
  source_type: 'donation' | 'stock_in'
  id: number
  supply_item_id: number
  location_id: number
  donor_name: string
  donor_contact: string
  donor_address: string | null
  donor_precinct: string | null
  donor_district: string | null
  donor_identity: string | null
  quantity: number
  source_time: string
  operator: string | null
  remark: string | null
}

export interface SupplyStockInLog {
  id: number
  supply_item_id: number
  location_id: number
  stock_in_quantity: number
  donor_name: string | null
  donor_contact: string | null
  donor_address: string | null
  donor_precinct: string | null
  donor_district: string | null
  donor_identity: string | null
  operator: string | null
  remark: string | null
  stock_in_time: string
  updated_at: string | null
}

export interface SupplyDisposalLog {
  id: number
  supply_item_id: number
  location_id: number
  disposal_quantity: number
  reason: string
  operator: string | null
  disposal_time: string
  remark: string | null
}

export interface SupplyTransferLog {
  id: number
  batch_id: string
  supply_item_id: number
  from_location_id: number
  to_location_id: number
  transfer_quantity: number
  transfer_time: string
  status: string
  confirmed_by: string | null
  confirmed_at: string | null
  operator: string | null
  remark: string | null
}

export interface AIStockInLog {
  id: number; location_id: number; input_type: string; input_text: string | null; input_image_path: string | null
  suggested_category: string | null; suggested_item_name: string | null; suggested_specification: string | null
  suggested_quantity: number | null; suggested_unit: string | null; suggested_stock_type: string | null
  suggested_expiration_date: string | null; suggested_safety_stock: number | null; suggested_remark: string | null
  confidence: number | null; is_confirmed: boolean; confirmed_supply_item_id: number | null; operator: string | null
  created_at: string; confirmed_at: string | null
}

export interface SupplyRequest {
  id: number
  category: string
  item_name: string
  specification: string | null
  requesting_location_id: number
  source_location_id: number | null
  quantity: number
  status: string // Open / Fulfilled / Cancelled
  request_type: 'supply' | 'disposal' // supply=缺料舉手；disposal=申請報廢
  supply_item_id: number | null // 報廢申請指定的批次
  requested_by: string | null
  note: string | null
  fulfilled_transfer_batch_id: string | null
  created_at: string
  updated_at: string | null
}

export interface SupplyItem {
  id: number
  category: string
  item_name: string
  specification: string | null
  quantity: number
  unit: string | null
  stock_type: string
  expiration_date: string | null
  image_path: string | null
  inventory_item_variant_id: number | null
  location_id: number
  safety_stock: number
  remark: string | null
  is_active: boolean
  created_by: string | null // 建立此批次的操作人（入庫時寫入）
  updated_by: string | null // 最後修改此批次的操作人（編輯時寫入）
  created_at: string
  updated_at: string | null
}
