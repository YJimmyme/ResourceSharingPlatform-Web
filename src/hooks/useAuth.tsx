// Replaces ASP.NET Cookie auth + claims (ClaimTypes.Role / "DisplayName" / "LocationId")
// with Supabase Auth + a `profiles` row fetched once after sign-in. Login keeps the
// existing 帳號登入 UX: the caller types a bare username, this hook translates it to the
// synthetic `{username}@local.invalid` email Supabase Auth actually stores (see migration
// plan §二) — no DB lookup needed, it's a deterministic string transform.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import { setActivityActor, clearActivityActor, logActivity } from '../lib/activityLog'
import type { Profile } from '../types/db'

const SYNTHETIC_EMAIL_SUFFIX = '@local.invalid'

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signIn: (username: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId: string) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (error) {
      console.error('Failed to load profile', error)
      setProfile(null)
      return
    }
    const p = data as Profile
    setProfile(p)
    // 稽核 Log 的 actor 快照（供 logActivity 使用）。
    setActivityActor({ id: p.id, name: p.display_name ?? p.username ?? null, role: p.role_name })
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) {
        loadProfile(session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (newSession?.user) {
        loadProfile(newSession.user.id)
      } else {
        setProfile(null)
        clearActivityActor()
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  // 全體使用者：閒置超過 30 分鐘（無滑鼠/鍵盤/觸控/捲動）自動登出。
  useEffect(() => {
    if (!session) return
    const IDLE_MS = 30 * 60 * 1000
    let timer: ReturnType<typeof setTimeout>
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { void supabase.auth.signOut() }, IDLE_MS)
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'] as const
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }))
    reset()
    return () => {
      clearTimeout(timer)
      events.forEach((ev) => window.removeEventListener(ev, reset))
    }
  }, [session])

  async function signIn(username: string, password: string): Promise<{ error: string | null }> {
    const email = `${username.trim()}${SYNTHETIC_EMAIL_SUFFIX}`
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      // Generic message on purpose (mirrors AccountController's "帳號或密碼錯誤" —
      // don't reveal whether the username exists).
      return { error: '帳號或密碼錯誤' }
    }
    // 稽核：登入（此時 profile 尚未載入，先用帳號當 actor_name）。
    if (data.user) {
      void logActivity({
        action: 'login', category: '登入', summary: `帳號「${username.trim()}」登入系統`,
        actorOverride: { id: data.user.id, name: username.trim() },
      })
    }
    return { error: null }
  }

  async function signOut() {
    // 稽核：登出（趁 session 還在、actor 仍設定時先寫）。
    await logActivity({ action: 'logout', category: '登入', summary: '登出系統' })
    clearActivityActor()
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
