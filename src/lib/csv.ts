/** Rows to CSV text. A leading =, +, - or @ is prefixed with a quote so spreadsheets don't run it as a formula. */
export function csv(rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return ""
    let text = String(value)
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n"
}
