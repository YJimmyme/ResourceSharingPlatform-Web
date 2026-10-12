// 日期選擇：原生 <input type="date">（有日曆彈窗可挑選），
// 值格式維持 'YYYY-MM-DD'，與其他欄位一致。
// 以 min/max 年份限制合理範圍（避免打成 20000 這種年份）。
export function DateSelect({
  value,
  onChange,
  fromYear,
  toYear,
}: {
  value: string
  onChange: (v: string) => void
  fromYear?: number
  toYear?: number
}) {
  const thisYear = new Date().getFullYear()
  const minY = fromYear ?? thisYear - 5
  const maxY = toYear ?? thisYear + 10

  return (
    <input
      type="date"
      className="form-control"
      value={value ?? ''}
      min={`${minY}-01-01`}
      max={`${maxY}-12-31`}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
