import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabaseClient'
import { APP_VERSION } from '../lib/version'

export function Login() {
  const { session, signIn } = useAuth()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // 忘記密碼：核對帳號後，直接由本人設定新密碼（總管端會看到「7 天內改過密碼」提示）。
  const [showForgot, setShowForgot] = useState(false)
  const [forgotName, setForgotName] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [forgotMsg, setForgotMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [forgotBusy, setForgotBusy] = useState(false)

  async function submitForgot(e: FormEvent) {
    e.preventDefault()
    if (!forgotName.trim()) return
    if (newPw.length < 6) { setForgotMsg({ ok: false, text: '新密碼至少 6 碼' }); return }
    if (newPw !== confirmPw) { setForgotMsg({ ok: false, text: '兩次輸入的新密碼不一致' }); return }
    setForgotBusy(true)
    setForgotMsg(null)
    const { data, error } = await supabase.functions.invoke('password-self-reset', { body: { username: forgotName.trim(), newPassword: newPw } })
    setForgotBusy(false)
    if (error || !data?.success) { setForgotMsg({ ok: false, text: data?.message ?? '重設失敗，請稍後再試或聯絡管理員。' }); return }
    setForgotMsg({ ok: true, text: '密碼已更新，請用新密碼登入。' })
    setForgotName(''); setNewPw(''); setConfirmPw('')
  }

  // 登入後一律導向物資總覽（/）；唯一例外是 LINE 圖文選單的 /mobile/* 深連結，
  // 保留使用者原本點的手機功能頁，其餘全部統一回物資總覽。
  const requested = (location.state as { from?: string })?.from
  const target = requested && requested.startsWith('/mobile/') ? requested : '/'

  if (session) {
    return <Navigate to={target} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await signIn(username, password)
    setSubmitting(false)
    if (error) {
      setError(error)
    }
    // On success `session` becomes truthy and the guard above redirects to `from`.
  }

  return (
    <div className="container d-flex justify-content-center align-items-center" style={{ minHeight: '80vh' }}>
      <span className="badge bg-secondary" style={{ position: 'fixed', right: 12, bottom: 12, zIndex: 10 }}>{APP_VERSION}</span>
      <div className="card shadow-sm" style={{ width: '100%', maxWidth: 400 }}>
        <div className="card-body p-4">
          <h2 className="text-center mb-4">
            <i className="bi bi-box-seam" /> 愛心轉運站
          </h2>
          {error && (
            <div className="alert alert-danger py-2" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label">帳號</label>
              <input
                className="form-control"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="mb-3">
              <label className="form-label">密碼</label>
              <input
                type="password"
                className="form-control"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
              {submitting ? '登入中…' : '登入'}
            </button>
          </form>

          <div className="text-center mt-3">
            <button type="button" className="btn btn-link btn-sm text-decoration-none" onClick={() => { setShowForgot((v) => !v); setForgotMsg(null) }}>
              忘記密碼？
            </button>
          </div>

          {showForgot && (
            <div className="border rounded p-3 mt-2 bg-light">
              <div className="small text-muted mb-2">輸入你的帳號並設定新密碼即可立即生效。管理員（總管）會看到你近期改過密碼作為把關。</div>
              {forgotMsg && <div className={`alert alert-${forgotMsg.ok ? 'success' : 'danger'} py-2`}>{forgotMsg.text}</div>}
              <form onSubmit={submitForgot}>
                <div className="mb-2">
                  <label className="form-label">你的帳號 *</label>
                  <input className="form-control form-control-sm" required value={forgotName} onChange={(e) => setForgotName(e.target.value)} />
                </div>
                <div className="mb-2">
                  <label className="form-label">新密碼 *（至少 6 碼）</label>
                  <input type="password" className="form-control form-control-sm" required value={newPw} onChange={(e) => setNewPw(e.target.value)} />
                </div>
                <div className="mb-2">
                  <label className="form-label">確認新密碼 *</label>
                  <input type="password" className="form-control form-control-sm" required value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
                </div>
                <button type="submit" className="btn btn-outline-primary btn-sm w-100" disabled={forgotBusy}>
                  {forgotBusy ? '重設中…' : '重設密碼'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
