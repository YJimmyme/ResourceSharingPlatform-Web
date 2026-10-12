// 日期區間判斷（與 components/DateRangeFilter 搭配）。
// 放在 lib 而非元件檔，避免元件檔混入非元件 export 導致 fast-refresh 失效。

/** 某 ISO 時間是否落在 [from, to] 區間內（含當日）；from/to 為空表示該端不限。 */
export function withinRange(iso: string | null | undefined, from: string, to: string): boolean {
  if (!iso) return !from && !to
  const d = iso.slice(0, 10)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}
