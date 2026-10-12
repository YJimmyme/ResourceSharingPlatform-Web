import { useRef, useState } from 'react'
import { visionRequest, type VisionBox, type VisionFeedback } from '../lib/visionApi'

export function VisionFeedbackEditor({ result, names }: { result: VisionFeedback; names: string[] }) {
  const [ratio, setRatio] = useState(1)
  const [boxes, setBoxes] = useState<VisionBox[]>(result.boxes)
  const [label, setLabel] = useState(names[0] ?? '')
  const [reviewed, setReviewed] = useState(false)
  const [negative, setNegative] = useState(false)
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<[number, number, number, number] | null>(null)
  const start = useRef<[number, number] | null>(null)
  const allNames = [...new Set(names)]
  async function save() {
    setBusy(true)
    try { const r = await visionRequest<{ message: string }>('/feedback', { id: result.id, boxes, reviewed, negative, note }); setMessage(r.message) }
    catch (e) { setMessage(e instanceof Error ? e.message : '保存失敗') }
    finally { setBusy(false) }
  }
  function point(e: React.PointerEvent<SVGSVGElement>): [number, number] {
    const r = e.currentTarget.getBoundingClientRect()
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]
  }
  return <details className="card p-3 my-3"><summary>辨識錯誤？框選並提交正確答案</summary>
    <p className="mt-2">來源：{result.provider}。拖曳新增框，每個可見外包裝框一次。錯框可刪除重畫；修正只提交訓練回饋，入庫表單仍須核對。</p>
    {[...result.reasons, ...result.warnings].map((x, i) => <div key={i} className="text-warning-emphasis">{x}</div>)}
    <label>新框品項 <select value={label} onChange={e => setLabel(e.target.value)}>{allNames.map(n => <option key={n}>{n}</option>)}</select></label>
    <img hidden src={result.image} onLoad={e => setRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} alt="" />
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{ width: '100%', aspectRatio: String(ratio), touchAction: 'none', background: '#eee' }}
      onPointerDown={e => { if (!label || busy) return; start.current = point(e); e.currentTarget.setPointerCapture(e.pointerId) }}
      onPointerMove={e => { if (!start.current) return; const p = point(e); setDraft([Math.min(p[0], start.current[0]), Math.min(p[1], start.current[1]), Math.max(p[0], start.current[0]), Math.max(p[1], start.current[1])]) }}
      onPointerUp={() => { if (draft && draft[2] - draft[0] > .005 && draft[3] - draft[1] > .005) { setBoxes([...boxes, { label, box: draft }]); setReviewed(false) } start.current = null; setDraft(null) }}
      onPointerCancel={() => { start.current = null; setDraft(null) }}>
      <image href={result.image} width="1000" height="1000" preserveAspectRatio="none" />
      {[...boxes, ...(draft ? [{ label, box: draft }] : [])].map((b, i) => <g key={i}><rect x={b.box[0] * 1000} y={b.box[1] * 1000} width={(b.box[2] - b.box[0]) * 1000} height={(b.box[3] - b.box[1]) * 1000} fill="none" stroke="#ff4500" strokeWidth="4" /><text x={b.box[0] * 1000} y={Math.max(25, b.box[1] * 1000)} fontSize="24" fill="#ff4500">{i + 1} {b.label}</text></g>)}
    </svg>
    {boxes.map((b, i) => <div key={i} className="d-flex gap-2 my-1"><span>{i + 1}</span><select value={b.label} onChange={e => { setBoxes(boxes.map((x, j) => j === i ? { ...x, label: e.target.value } : x)); setReviewed(false) }}>{!allNames.includes(b.label) && <option>{b.label}</option>}{allNames.map(n => <option key={n}>{n}</option>)}</select><button type="button" onClick={() => { setBoxes(boxes.filter((_, j) => j !== i)); setReviewed(false) }}>刪除</button></div>)}
    <input className="form-control my-2" placeholder="錯誤或修正說明" value={note} onChange={e => setNote(e.target.value)} />
    <label><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} /> 已核對所有品項及框，沒有漏標</label>
    <label><input type="checkbox" checked={negative} onChange={e => setNegative(e.target.checked)} /> 這是無目標物件的空場景</label>
    <button type="button" className="btn btn-outline-primary mt-2" disabled={busy || !reviewed} onClick={() => void save()}>提交人工修正回饋</button>
    {message && <p role="status">{message}</p>}
  </details>
}
