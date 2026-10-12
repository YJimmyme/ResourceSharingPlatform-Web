import { supabase } from './supabaseClient'
export const visionBase = (import.meta.env.VITE_RECOGNITION_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''
export type VisionBox = { label: string; box: [number, number, number, number]; confidence?: number }
export type VisionFeedback = { id: string; image: string; boxes: VisionBox[]; provider: string; warnings: string[]; reasons: string[] }
export async function visionRequest<T>(path: string, body?: unknown): Promise<T> {
  if (!visionBase) throw new Error('尚未設定辨識服務位址')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('請先登入')
  const response = await fetch(`${visionBase}/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(240000), body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? data.message ?? '辨識服務失敗')
  return data as T
}
