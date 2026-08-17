import { describe, expect, it } from 'vitest'

import { toCsv } from './csv.ts'

describe('toCsv', () => {
  it('writes a header and a row', () => {
    expect(toCsv(['name', 'paid'], [{ name: 'Ana', paid: true }])).toBe('"name","paid"\r\n"Ana","true"')
  })

  it('survives the free text admins actually write', () => {
    const row = { notes: 'gluten, dairy\nand "nuts"' }

    expect(toCsv(['notes'], [row])).toBe('"notes"\r\n"gluten, dairy\nand ""nuts"""')
  })

  it('defuses a value a spreadsheet would run as a formula', () => {
    const row = { notes: '=HYPERLINK("https://evil.example","Click")' }

    expect(toCsv(['notes'], [row])).toContain(`"'=HYPERLINK`)
  })

  it('defuses every leading character a spreadsheet acts on', () => {
    for (const start of ['=', '+', '-', '@', '\t', '\r']) {
      expect(toCsv(['a'], [{ a: `${start}cmd` }]), start).toContain(`"'${start}cmd"`)
    }
  })

  it('leaves ordinary text alone, apostrophe and all', () => {
    expect(toCsv(['a'], [{ a: "Ana's tent" }])).toBe('"a"\r\n"Ana\'s tent"')
  })

  it('writes an empty cell for a missing or null value', () => {
    const row: { a: string | null; b?: string } = { a: null }

    expect(toCsv(['a', 'b'], [row])).toBe('"a","b"\r\n"",""')
  })

  it('writes just the header when there is nobody', () => {
    expect(toCsv(['name'], [])).toBe('"name"')
  })
})

describe('a column holding a list', () => {
  it('writes the items into one quoted field, commas and all', () => {
    expect(toCsv(['who', 'allergy_items'], [{ who: 'Ana', allergy_items: ['Vegan', 'Lactose'] }])).toBe(
      '"who","allergy_items"\r\n"Ana","Vegan,Lactose"',
    )
  })

  it('writes an empty field for somebody who ticked nothing', () => {
    expect(toCsv(['allergy_items'], [{ allergy_items: [] }])).toBe('"allergy_items"\r\n""')
  })
})
