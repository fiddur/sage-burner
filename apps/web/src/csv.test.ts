import { describe, expect, it } from 'vitest'

import { toCsv } from './csv.ts'

describe('toCsv', () => {
  it('writes a header and a row', () => {
    expect(toCsv(['name', 'paid'], [{ name: 'Ana', paid: true }])).toBe('"name","paid"\r\n"Ana","true"')
  })

  it('survives the free text organisers actually write', () => {
    // Allergies and notes are where commas, quotes and newlines live, and any of
    // the three silently breaks a spreadsheet that reads a naive join.
    const row = { notes: 'gluten, dairy\nand "nuts"' }

    expect(toCsv(['notes'], [row])).toBe('"notes"\r\n"gluten, dairy\nand ""nuts"""')
  })

  it('defuses a value a spreadsheet would run as a formula', () => {
    // Quoting does not help: Excel, LibreOffice and Sheets all evaluate a leading
    // `=` inside quotes, and every exported field is member-editable free text.
    const row = { notes: '=HYPERLINK("https://evil.example","Click")' }

    expect(toCsv(['notes'], [row])).toContain(`"'=HYPERLINK`)
  })

  it('defuses every leading character a spreadsheet acts on', () => {
    for (const start of ['=', '+', '-', '@', '\t', '\r']) {
      expect(toCsv(['a'], [{ a: `${start}cmd` }]), start).toContain(`"'${start}cmd"`)
    }
  })

  it('leaves ordinary text alone, apostrophe and all', () => {
    // The prefix must not appear where it is not needed, or every export grows a
    // stray quote an organiser has to strip.
    expect(toCsv(['a'], [{ a: "Ana's tent" }])).toBe('"a"\r\n"Ana\'s tent"')
  })

  it('writes an empty cell for a missing or null value', () => {
    expect(toCsv(['a', 'b'], [{ a: null }])).toBe('"a","b"\r\n"",""')
  })

  it('writes just the header when there is nobody', () => {
    expect(toCsv(['name'], [])).toBe('"name"')
  })
})
