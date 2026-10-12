import { useCallback, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { visionBase } from '../lib/visionApi'
export function VisionTraining() {
  const { session } = useAuth()
  const frame = useRef<HTMLIFrameElement>(null)
  const href = visionBase ? new URL(`${visionBase}/workbench`, window.location.href).href : ''
  const authenticate = useCallback(() => {
    if (href) frame.current?.contentWindow?.postMessage({ type: 'vision-auth', token: session?.access_token ?? '' }, new URL(href).origin)
  }, [href, session?.access_token])
  useEffect(() => { authenticate() }, [authenticate])
  return <div className="container-fluid mt-3"><h2>AI 模型管理</h2>{href ? <iframe ref={frame} src={href} title="模型訓練工作台" onLoad={authenticate} style={{ width: '100%', height: '85vh', border: 0 }} /> : <p>請先設定 VITE_RECOGNITION_API_URL。</p>}</div>
}
