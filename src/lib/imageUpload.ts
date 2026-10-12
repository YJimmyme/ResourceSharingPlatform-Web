// Port of SupplyItemController.SaveImageAsync's naming convention:
// {種類}-{名稱}-{規格}-{數量}-{日期}-{流水號}.{副檔名}, e.g.
// 食品-飲用水-600ml-250-20260809-001.png — see migration plan §六.
//
// DEVIATION FROM THE PLAN, discovered via a live test (2026-08-13): Supabase
// Storage object keys reject non-ASCII characters outright (confirmed via a
// direct API call — a pure-Chinese key returns 400 InvalidKey; an ASCII key
// passes validation). The .NET app's filenames embed raw Chinese text
// (物資種類-物資名稱-規格-...), which the Windows filesystem allows but
// Supabase Storage's key validator does not. Since almost every
// category/item_name/specification value in this app IS Chinese text with no
// ASCII fallback, "sanitize and keep the Chinese" (the .NET approach) isn't
// viable here — instead this strips non-ASCII characters, and always
// includes the numeric inventory_item_definition id so the filename stays
// unique/traceable even when every text field gets stripped down to nothing
// (the common case). The human-readable category/name/spec is still recorded
// properly in supply_item's own columns; the filename no longer needs to
// duplicate it verbatim now that files are browsed through the app, not a
// Windows folder.
import { supabase } from './supabaseClient'

// Keeps only ASCII letters/digits (Chinese and other non-ASCII text is
// dropped, not replaced by a placeholder) and collapses everything else to
// '_'. Different from the .NET SanitizeForFileName (which only stripped
// filesystem-illegal characters and kept Chinese) precisely because of the
// Supabase Storage key restriction described above.
export function sanitizeForFileName(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0')
}

async function nextSequence(bucket: string, prefix: string): Promise<number> {
  const { data, error } = await supabase.storage.from(bucket).list('', { search: prefix })
  if (error || !data) return 1
  let max = 0
  for (const f of data) {
    const m = f.name.match(new RegExp(`^${prefix}-(\\d{3})\\.[a-zA-Z0-9]+$`))
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return max + 1
}

export async function uploadItemPhoto(
  file: File,
  fields: { definitionId: number; category: string; itemName: string; specification: string | null; quantity: number }
): Promise<{ path: string; error: string | null }> {
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  const asciiParts = [
    sanitizeForFileName(fields.category),
    sanitizeForFileName(fields.itemName),
    sanitizeForFileName(fields.specification),
  ].filter(Boolean)

  const parts = [`def${fields.definitionId}`, ...asciiParts, fields.quantity.toString(), dateStr]
  const prefix = parts.join('-')

  const seq = await nextSequence('items', prefix)
  const fileName = `${prefix}-${pad3(seq)}.${ext}`

  const { error } = await supabase.storage.from('items').upload(fileName, file, { upsert: false })
  if (error) {
    return { path: '', error: error.message }
  }
  return { path: fileName, error: null }
}

export function itemPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null
  const { data } = supabase.storage.from('items').getPublicUrl(path)
  return data.publicUrl
}

// The human-facing Chinese filename the user actually wants:
//   {種類}-{名稱}-{規格}-{數量}{單位}-{日期}{流水號}.{副檔名}
//   e.g. 食品-飲用水-600ml-10瓶-20260818001.jpg
// Supabase Storage keys can't hold this (non-ASCII → InvalidKey, see top of
// file), so it is delivered as the *download* filename (Content-Disposition)
// rather than the stored object key. 數量/日期/流水號 come from the ASCII key
// (which embeds them at upload time: `...-{qty}-{yyyymmdd}-{seq}.ext`); the
// Chinese 種類/名稱/規格/單位 come from the supply_item row. Older keys that
// don't parse fall back to the row's current quantity and today's date.
type PhotoNameFields = {
  category: string
  item_name: string
  specification: string | null
  quantity: number
  unit: string | null
  image_path: string | null | undefined
}

export function itemPhotoDownloadName(item: PhotoNameFields): string | null {
  if (!item.image_path) return null
  const ext = item.image_path.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const parsed = item.image_path.match(/-(\d+)-(\d{8})-(\d{3})\.[a-z0-9]+$/i)
  const qty = parsed ? parsed[1] : String(item.quantity)
  const dateSeq = parsed ? `${parsed[2]}${parsed[3]}` : new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const spec = item.specification?.trim() || '無'
  return `${item.category}-${item.item_name}-${spec}-${qty}${item.unit ?? ''}-${dateSeq}.${ext}`
}

// Public URL that downloads/saves as the Chinese filename above (?download=…).
// Use this for a download link; keep itemPhotoUrl() for inline <img src>.
export function itemPhotoDownloadUrl(item: PhotoNameFields): string | null {
  if (!item.image_path) return null
  const download = itemPhotoDownloadName(item)
  const { data } = supabase.storage.from('items').getPublicUrl(item.image_path, download ? { download } : {})
  return data.publicUrl
}

// AI 影像入庫確認後，把暫存在 ai-stockin 的原始照片搬進 items 集中管理，並掛到剛
// 入庫的批次上。刻意改在前端做（不靠 Edge Function 的手動部署）：確認者對自己上傳
// 的 ai-stockin 檔有讀取權、對 items 有寫入權、對自己據點的 supply_item 有更新權，
// 全走 RLS。實體檔名維持 ASCII（aiN-數量-日期-001.副檔名），可被 itemPhotoDownloadName
// 解析出中文下載名。任何一步失敗都不影響入庫本身（庫存已寫入），只是照片沒搬成。
export async function attachAiPhotoToItem(
  item: { id: number; quantity: number; image_path: string | null | undefined } | null | undefined,
  aiStockinPath: string | null | undefined
): Promise<void> {
  if (!item || !aiStockinPath || item.image_path) return
  try {
    const { data: blob } = await supabase.storage.from('ai-stockin').download(aiStockinPath)
    if (!blob) return
    const ext = aiStockinPath.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const key = `ai${item.id}-${item.quantity}-${dateStr}-001.${ext}`
    const { error } = await supabase.storage.from('items').upload(key, blob, { contentType: blob.type || 'image/jpeg', upsert: false })
    if (error) return
    await supabase.from('supply_item').update({ image_path: key }).eq('id', item.id)
    await supabase.storage.from('ai-stockin').remove([aiStockinPath])
  } catch {
    /* 照片搬移失敗不影響入庫 */
  }
}

// AI 智慧入庫「一張照片多筆品項」：把同一張 ai-stockin 照片複製給每一筆
// 確認後的 supply_item（各自一份 items/ 副本），最後才刪除來源，避免像
// attachAiPhotoToItem 那樣第一筆就把來源刪掉、其餘品項拿不到照片。
export async function attachSharedAiPhoto(
  aiStockinPath: string | null | undefined,
  items: { id: number; quantity: number }[]
): Promise<void> {
  if (!aiStockinPath || !items.length) return
  try {
    const { data: blob } = await supabase.storage.from('ai-stockin').download(aiStockinPath)
    if (!blob) return
    const ext = aiStockinPath.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    for (const it of items) {
      const key = `ai${it.id}-${it.quantity}-${dateStr}-001.${ext}`
      const { error } = await supabase.storage.from('items').upload(key, blob, { contentType: blob.type || 'image/jpeg', upsert: false })
      if (!error) await supabase.from('supply_item').update({ image_path: key }).eq('id', it.id)
    }
    await supabase.storage.from('ai-stockin').remove([aiStockinPath])
  } catch {
    /* 照片搬移失敗不影響入庫 */
  }
}

// 編輯物資時替換照片：直接上傳到 items，鍵維持 itemPhotoDownloadName 可解析的
// 格式（item{id}-{數量}-{日期}-{隨機序}.副檔名），隨機序避免同一天同物資重傳撞名。
export async function uploadReplacementPhoto(
  file: File,
  item: { id: number; quantity: number }
): Promise<{ path: string; error: string | null }> {
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const seq = String(Math.floor(Math.random() * 900) + 100)
  const key = `item${item.id}-${item.quantity}-${dateStr}-${seq}.${ext}`
  const { error } = await supabase.storage.from('items').upload(key, file, { upsert: false })
  if (error) return { path: '', error: error.message }
  return { path: key, error: null }
}

export async function deleteItemPhoto(path: string | null | undefined): Promise<void> {
  if (!path) return
  await supabase.storage.from('items').remove([path])
}
