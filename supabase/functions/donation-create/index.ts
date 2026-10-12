// Port of SupplyDonationController.Create (POST) + SupplyDonationService.
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

interface Body {
  supplyItemId: number
  locationId: number
  donationQuantity: number
  donorName: string
  donorContact?: string
  remark?: string
  donorAddress?: string
  donorPrecinct?: string | null
  donorDistrict?: string | null
  donorIdentity?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const ctx = await requireCaller(req)
    const body = (await req.json()) as Body

    if (!body.donorName?.trim()) {
      throw new AuthError('請輸入捐贈者姓名', 400)
    }

    assertLocationAccess(ctx, body.locationId)

    const operatorName = ctx.profile.display_name ?? ctx.profile.username

    const { data, error } = await ctx.adminClient.rpc('donation_create', {
      p_supply_item_id: body.supplyItemId,
      p_location_id: body.locationId,
      p_donation_quantity: body.donationQuantity,
      p_donor_name: body.donorName.trim(),
      p_donor_contact: body.donorContact?.trim() || null,
      p_operator: operatorName,
      p_remark: body.remark?.trim() || null,
      p_donor_address: body.donorAddress?.trim() || null,
      p_donor_precinct: body.donorPrecinct || null,
      p_donor_district: body.donorDistrict || null,
      p_donor_identity: body.donorIdentity || null,
    })

    if (error) {
      throw new AuthError(error.message, 400)
    }

    ctx.adminClient.functions
      .invoke('line-notify', { body: { triggeredBy: 'donation' } })
      .catch((e: unknown) => console.error('line-notify failed', e))

    return new Response(JSON.stringify({ success: true, message: '捐贈入庫完成', log: data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 500
    const message = e instanceof Error ? e.message : '捐贈失敗'
    return new Response(JSON.stringify({ success: false, message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
