const FORMULA_STARTS = ['=', '+', '-', '@', '\t', '\r']

const defuse = (text: string) => (FORMULA_STARTS.some((start) => text.startsWith(start)) ? `'${text}` : text)

const escape = (value: unknown) => {
  if (value === null || value === undefined) return '""'

  return `"${defuse(String(value)).replaceAll('"', '""')}"`
}

export const toCsv = <Row extends object>(columns: readonly (keyof Row & string)[], rows: readonly Row[]) =>
  [
    columns.map(escape).join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(',')),
  ].join('\r\n')
