// Port of SupplyOutboundController.Create (POST) + SupplyOutboundService.IssueAsync.
// Self-contained (no relative imports) so it can be pasted directly into the
// Supabase Dashboard's single-file "Via Editor" deploy flow.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CallerProfile {
  id: string
  username: string
  display_name: string | null
  role_name: 'Admin' | 'Cadre' | 'SocialWorker'
  location_id: number | null
  is_active: boolean
}

class AuthError extends Error {
  status: number
  constructor(message: string, status = 403) {
    super(message)
    this.status = status
  }
}

async function requireCaller(req: Request): Promise<{ profile: CallerProfile; adminClient: SupabaseClient; isAdmin: boolean }> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) throw new AuthError('缺少登入憑證', 401)

  const callerClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )

  const {
    data: { user },
  } = await callerClient.auth.getUser()
  if (!user) throw new AuthError('登入已失效，請重新登入', 401)

  const { data: profile, error } = await callerClient.from('profiles').select('*').eq('id', user.id).single()
  if (error || !profile) throw new AuthError('找不到使用者資料', 401)
  if (!profile.is_active) throw new AuthError('帳號已停用', 403)

  const adminClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  return { profile: profile as CallerProfile, adminClient, isAdmin: profile.role_name === 'Admin' }
}

function assertLocationAccess(ctx: { profile: CallerProfile; isAdmin: boolean }, locationId: number) {
  if (ctx.isAdmin) return
  if (ctx.profile.location_id == null) throw new AuthError('您的帳號尚未指定所屬據點，無法執行此操作', 403)
  if (ctx.profile.location_id !== locationId) throw new AuthError('您沒有權限在此據點執行此操作', 403)
}

// 兩種呼叫方式並存：
//   批次（Web 的物資出庫頁）  → 帶 items[]，走 outbound_create_batch()
//   單筆（手機版領用、LINE Bot）→ 帶 supplyItemId/outboundQuantity，走原本的 outbound_create()
// 保留單筆路徑是為了不動 MobileFeatures.tsx 與 line-webhook 那兩條切片。
interface BatchEntry {
  supplyItemId: number
  quantity: number
}

interface RecipientEntry {
  name: string
  contact?: string
  precinct?: string
  district?: string
  identity?: string
  items: BatchEntry[]
}

interface Body {
  locationId: number
  recipientName?: string
  recipientContact?: string
  remark?: string
  // 批次專用（單一領用人多品項）
  items?: BatchEntry[]
  recipientPrecinct?: string
  recipientDistrict?: string
  recipientIdentity?: string
  // 多人專用（多位領用人各自的物資清單）
  recipients?: RecipientEntry[]
  // 單筆專用
  supplyItemId?: number
  outboundQuantity?: number
}

const VALID_IDENTITIES = ['LowIncome', 'MidLowIncome', 'General', 'Other']

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const ctx = await requireCaller(req)
    const body = (await req.json()) as Body

    assertLocationAccess(ctx, body.locationId)

    const operatorName = ctx.profile.display_name ?? ctx.profile.username
    const isMulti = Array.isArray(body.recipients)
    const isBatch = !isMulti && Array.isArray(body.items)

    let data: unknown
    let error: { message: string } | null

    if (isMulti) {
      const recipients = body.recipients ?? []
      if (recipients.length === 0) throw new AuthError('請至少加入一位領用人', 400)
      for (const r of recipients) {
        if (!r?.name?.trim()) throw new AuthError('每一位領用人都要填姓名', 400)
        if (!r.district?.trim()) throw new AuthError(`「${r.name ?? ''}」請選擇所屬鄉鎮`, 400)
        if (!r.identity || !VALID_IDENTITIES.includes(r.identity)) throw new AuthError(`「${r.name ?? ''}」請選擇身分別`, 400)
        if (!Array.isArray(r.items) || r.items.length === 0) throw new AuthError(`「${r.name ?? ''}」至少要領一項物資`, 400)
        for (const it of r.items) {
          if (!it?.supplyItemId || !Number.isInteger(it.quantity) || it.quantity <= 0) {
            throw new AuthError(`「${r.name ?? ''}」的領用清單有一列物資或數量不正確`, 400)
          }
        }
      }
      const res = await ctx.adminClient.rpc('outbound_create_multi', {
        p_location_id: body.locationId,
        p_recipients: recipients.map((r) => ({
          name: r.name.trim(),
          contact: r.contact?.trim() || null,
          precinct: r.precinct?.trim() || null,
          district: r.district?.trim() || null,
          identity: r.identity || null,
          items: r.items.map((it) => ({ supplyItemId: it.supplyItemId, quantity: it.quantity })),
        })),
        p_operator: operatorName,
        p_remark: body.remark?.trim() || null,
      })
      data = res.data
      error = res.error
    } else if (isBatch) {
      if (!body.recipientName?.trim()) throw new AuthError('請輸入領用人姓名', 400)
      const items = body.items ?? []
      if (items.length === 0) {
        throw new AuthError('請至少加入一項要出庫的物資', 400)
      }
      for (const it of items) {
        if (!it?.supplyItemId || !Number.isInteger(it.quantity) || it.quantity <= 0) {
          throw new AuthError('出庫清單中有一列的物資或數量不正確', 400)
        }
      }
      if (!body.recipientDistrict?.trim()) {
        throw new AuthError('請選擇領用人所屬鄉鎮', 400)
      }
      if (!body.recipientIdentity || !VALID_IDENTITIES.includes(body.recipientIdentity)) {
        throw new AuthError('請選擇領用人身分別', 400)
      }

      const res = await ctx.adminClient.rpc('outbound_create_batch', {
        p_location_id: body.locationId,
        p_items: items.map((it) => ({ supplyItemId: it.supplyItemId, quantity: it.quantity })),
        p_recipient_name: body.recipientName.trim(),
        p_recipient_contact: body.recipientContact?.trim() || null,
        p_recipient_precinct: body.recipientPrecinct?.trim() || null,
        p_recipient_district: body.recipientDistrict.trim(),
        p_recipient_identity: body.recipientIdentity,
        p_operator: operatorName,
        p_remark: body.remark?.trim() || null,
      })
      data = res.data
      error = res.error
    } else {
      if (!body.recipientName?.trim()) throw new AuthError('請輸入領用人姓名', 400)
      const res = await ctx.adminClient.rpc('outbound_create', {
        p_supply_item_id: body.supplyItemId,
        p_location_id: body.locationId,
        p_outbound_quantity: body.outboundQuantity,
        p_recipient_name: body.recipientName.trim(),
        p_recipient_contact: body.recipientContact?.trim() || null,
        p_operator: operatorName,
        p_remark: body.remark?.trim() || null,
      })
      data = res.data
      error = res.error
    }

    if (error) {
      throw new AuthError(error.message, 400)
    }

    ctx.adminClient.functions
      .invoke('line-notify', { body: { triggeredBy: 'outbound' } })
      .catch((e: unknown) => console.error('line-notify failed', e))

    const message = isMulti
      ? `領用完成，共 ${body.recipients?.length ?? 0} 位領用人`
      : isBatch
        ? `領用完成，共 ${body.items?.length ?? 0} 項物資`
        : '領用完成'

    return new Response(JSON.stringify({ success: true, message, log: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 500
    const message = e instanceof Error ? e.message : '出庫失敗'
    return new Response(JSON.stringify({ success: false, message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
