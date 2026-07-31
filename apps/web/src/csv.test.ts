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

  it('writes an empty cell for a missing or null value', () => {
    expect(toCsv(['a', 'b'], [{ a: null }])).toBe('"a","b"\r\n"",""')
  })

  it('writes just the header when there is nobody', () => {
    expect(toCsv(['name'], [])).toBe('"name"')
  })
})
