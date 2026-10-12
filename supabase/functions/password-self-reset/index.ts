// 忘記密碼自助重設（未登入可呼叫）：輸入帳號 + 新密碼 → 直接重設該帳號密碼，
// 並在 profiles.password_changed_at 蓋上時間戳，讓總管在帳號管理看到「7 天內改過密碼」。
//
// ⚠️ 安全性說明：此流程僅以「帳號存在且啟用」為核對條件即可改密碼（使用者自行決定
// 的設計）。總管端會即時看到誰改了密碼作為把關。若日後要更嚴謹，可再加驗證碼／
// LINE 綁定確認等步驟。
//
// 部署：Supabase Dashboard → Edge Functions → 新增 password-self-reset → 貼上本檔 → Deploy。
// 不需額外 secret（用內建 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）。
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { username, newPassword } = await req.json() as { username?: string; newPassword?: string }
    const uname = (username ?? '').trim()
    if (!uname) throw new Error('請輸入帳號')
    if (!newPassword || newPassword.length < 6) throw new Error('新密碼至少 6 碼')

    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const { data: profile } = await admin.from('profiles').select('id, is_active').eq('username', uname).maybeSingle()
    if (!profile) throw new Error('查無此帳號，請確認帳號是否正確')
    if (!profile.is_active) throw new Error('此帳號已停用，請聯絡管理員')

    const { error: updErr } = await admin.auth.admin.updateUserById(profile.id, { password: newPassword })
    if (updErr) throw new Error(updErr.message)

    await admin.from('profiles').update({ password_changed_at: new Date().toISOString() }).eq('id', profile.id)

    return Response.json({ success: true, message: '密碼已更新，請用新密碼登入。' }, { headers: cors })
  } catch (e) {
    return new Response(JSON.stringify({ success: false, message: e instanceof Error ? e.message : '重設失敗' }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
