// 紀錄/分析頁共用的「日期區間」篩選（起始日 ~ 結束日），用 DateSelect（年/月/日下拉），
// 避免原生日曆的「今天」誤按。值為 'YYYY-MM-DD' 或空字串。
import { DateSelect } from './DateSelect'

export function DateRangeFilter({
  from,
  to,
  onFrom,
  onTo,
  fromYear,
}: {
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
  fromYear?: number
}) {
  return (
    <div>
      <div className="mb-1">
        <span className="text-muted small">起始日</span>
        <DateSelect value={from} onChange={onFrom} fromYear={fromYear} />
      </div>
      <div>
        <span className="text-muted small">結束日</span>
        <DateSelect value={to} onChange={onTo} fromYear={fromYear} />
      </div>
    </div>
  )
}
