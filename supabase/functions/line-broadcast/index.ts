// LINE 被動式物資通報：把前端組好的自訂訊息，推播給所有「已綁定且開啟通知」的
// LINE 使用者。與 line-notify 不同——這支不自動產生警示內容，而是直接送 body.message。
// 權限：僅總管（Admin）可呼叫。需「LINE 通知設定」已啟用並填入 channel_access_token。
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const auth = req.headers.get('Authorization')
    if (!auth) throw new Error('缺少登入憑證')
    const token = auth.replace(/^Bearer\s+/i, '')
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    // 非服務金鑰呼叫時，驗證呼叫者為啟用中的總管。
    if (token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      const caller = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: auth } } })
      const { data: { user } } = await caller.auth.getUser()
      if (!user) throw new Error('登入已失效')
      const { data: profile } = await caller.from('profiles').select('role_name,is_active').eq('id', user.id).single()
      if (profile?.role_name !== 'Admin' || !profile.is_active) throw new Error('僅管理員可推播物資通報')
    }

    const body = await req.json().catch(() => ({}))
    const text = String(body.message ?? '').trim()
    if (!text) return Response.json({ success: false, message: '訊息內容不可為空' }, { status: 400, headers: cors })

    const { data: s } = await admin.from('line_notification_settings').select('*').limit(1).maybeSingle()
    if (!s?.is_enabled || !s.channel_access_token) {
      return Response.json({ success: false, message: 'LINE 通知未啟用或尚未設定 Token（請先到「LINE 通知設定」設定）' }, { status: 400, headers: cors })
    }

    const { data: bindings } = await admin.from('line_bindings').select('line_user_id').eq('notify_enabled', true)
    if (!bindings?.length) return Response.json({ success: false, message: '目前沒有已綁定並開啟通知的 LINE 使用者' }, { status: 400, headers: cors })

    let sent = 0, failed = 0
    for (const binding of bindings) {
      const r = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { Authorization: `Bearer ${s.channel_access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: binding.line_user_id, messages: [{ type: 'text', text }] }),
      })
      if (r.ok) sent++
      else failed++
    }
    return Response.json({ success: true, message: `物資通報推播完成：成功 ${sent}、失敗 ${failed}`, sent, failed }, { headers: cors })
  } catch (e) {
    return new Response(JSON.stringify({ success: false, message: e instanceof Error ? e.message : '推播失敗' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
