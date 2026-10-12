// Client-side "匯出 Excel" — builds a real .xlsx from already-loaded, already
// filtered rows (no server round-trip). Replaces the old .NET ExcelExportHelper.
// We only ever WRITE workbooks from our own data (never parse uploaded files),
// so SheetJS's parse-path CVEs don't apply here.
import * as XLSX from 'xlsx'

// total: true 的欄位會在最後加一列「總計」，把該欄的數值加總。
export type ExcelColumn<T> = {
  header: string
  value: (row: T) => string | number | null | undefined
  total?: boolean
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`
}

export function exportToExcel<T>(baseName: string, sheetName: string, columns: ExcelColumn<T>[], rows: T[]): void {
  const aoa: (string | number)[][] = [
    columns.map((c) => c.header),
    ...rows.map((r) => columns.map((c) => c.value(r) ?? '')),
  ]

  // 若有欄位標記 total，於底部加一列「總計」，加總這些欄位的數值。
  const hasTotal = columns.some((c) => c.total)
  if (hasTotal && rows.length > 0) {
    const totalRow = columns.map((c, idx) => {
      if (c.total) {
        return rows.reduce((sum, r) => {
          const v = Number(c.value(r))
          return sum + (Number.isFinite(v) ? v : 0)
        }, 0)
      }
      return idx === 0 ? '總計' : ''
    })
    aoa.push(totalRow)
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(10, c.header.length * 2 + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, `${baseName}_${stamp()}.xlsx`)
}

// 直接用「列陣列」(array-of-arrays) 輸出，可一次寫多個工作表。
// 給固定版面的報表用（例如捐贈分析的稀疏列、領取分析的雙工作表），
// 不像 exportToExcel 綁定單一 typed row。第一列視為表頭、自動抓欄寬。
export type ExcelSheet = {
  name: string
  rows: (string | number | null | undefined)[][]
}

export function exportSheetsToExcel(baseName: string, sheets: ExcelSheet[]): void {
  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const aoa = sheet.rows.map((r) => r.map((c) => c ?? ''))
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    // 欄寬：取各欄內容最長者，中文字估兩個字寬。
    const colCount = aoa.reduce((m, r) => Math.max(m, r.length), 0)
    ws['!cols'] = Array.from({ length: colCount }, (_, ci) => {
      const widest = aoa.reduce((m, r) => Math.max(m, String(r[ci] ?? '').length), 0)
      return { wch: Math.max(10, widest * 2 + 2) }
    })
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31))
  }
  XLSX.writeFile(wb, `${baseName}_${stamp()}.xlsx`)
}
