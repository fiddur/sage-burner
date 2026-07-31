/**
 * A CSV an organiser can open in a spreadsheet.
 *
 * Quoting is unconditional rather than only-when-needed: allergies and notes are
 * free text that will contain commas, quotes and newlines, and a rule applied
 * some of the time is one that gets tested some of the time.
 */
const escape = (value: unknown) => {
  if (value === null || value === undefined) return '""'

  return `"${String(value).replaceAll('"', '""')}"`
}

export const toCsv = (columns: readonly string[], rows: readonly Record<string, unknown>[]) =>
  [
    columns.map(escape).join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(',')),
  ].join('\r\n')
