// 前端稽核 Log 埋點：各操作成功後呼叫 logActivity() 寫一筆 activity_log。
// actor（誰）由 useAuth 於登入/載入 profile 後以 setActivityActor 設定，
// 這樣呼叫端不必到處傳 profile。寫入失敗一律吞掉，不影響主流程。
import { supabase } from './supabaseClient'

export type ActivityCategory = '登入' | '庫存異動' | '資料維護' | '申請'

type Actor = { id: string | null; name: string | null; role: string | null }
let actor: Actor = { id: null, name: null, role: null }

export function setActivityActor(a: Actor) {
  actor = a
}

export function clearActivityActor() {
  actor = { id: null, name: null, role: null }
}

export interface ActivityEntry {
  action: string
  category: ActivityCategory
  summary: string
  targetTable?: string | null
  targetId?: string | number | null
  locationId?: number | null
  detail?: unknown
  // 少數情境（如登入當下 profile 尚未載入）可覆寫 actor。
  actorOverride?: Partial<Actor>
}

export async function logActivity(entry: ActivityEntry): Promise<void> {
  const a = { ...actor, ...(entry.actorOverride ?? {}) }
  try {
    await supabase.from('activity_log').insert({
      actor_id: a.id,
      actor_name: a.name,
      actor_role: a.role,
      action: entry.action,
      category: entry.category,
      target_table: entry.targetTable ?? null,
      target_id: entry.targetId != null ? String(entry.targetId) : null,
      location_id: entry.locationId ?? null,
      summary: entry.summary,
      detail: entry.detail ?? null,
    })
  } catch {
    /* 稽核寫入失敗不影響主流程 */
  }
}
