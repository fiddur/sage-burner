import { eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from './db/index.ts'

import { createDb, runMigrations } from './db/index.ts'
import { pantryItem } from './db/schema.ts'
import { importPantry, readPantryTsv } from './pantry-import.ts'

const NOW = '2026-09-18T10:00:00.000Z'

const HEADER = 'name\tkind\tunit\twhere'

let handle: DbHandle | undefined

afterEach(() => {
  handle?.close()
  handle = undefined
})

const build = () => {
  handle = createDb({ url: ':memory:' })
  runMigrations(handle)

  return handle.db
}

const lines = (text: string) => {
  const reading = readPantryTsv(text)
  if (reading.kind !== 'ok') throw new Error(reading.problem)

  return reading.lines
}

const problem = (text: string) => {
  const reading = readPantryTsv(text)

  return reading.kind === 'bad' ? reading.problem : undefined
}

describe('reading a sheet somebody exported', () => {
  it('takes a header and the rows under it', () => {
    expect(lines(`${HEADER}\nOatmeal\tbreakfast\tkg\tHallway bucket · cellar I`)).toEqual([
      { kind: 'breakfast', name: 'Oatmeal', unit: 'kg', where: 'Hallway bucket · cellar I' },
    ])
  })

  it('steps over blank lines, which every exported sheet has', () => {
    expect(lines(`\n${HEADER}\n\nDates\tsnack\tkg\t\n\n`)).toEqual([
      { kind: 'snack', name: 'Dates', unit: 'kg', where: '' },
    ])
  })

  it('counts an unnamed unit as pieces, the way the form does', () => {
    expect(lines(`${HEADER}\nToilet paper\thousehold\t\t`)[0]?.unit).toBe('pcs')
  })

  it('names the line a kind nobody knows is on', () => {
    expect(problem(`${HEADER}\nDates\tsnack\tkg\t\nCumin\tpudding\tg\t`)).toContain('Line 3')
  })

  it('names the line a column is missing from', () => {
    expect(problem(`${HEADER}\nDates\tsnack`)).toContain('Line 2')
  })

  it('refuses a line with nothing named on it', () => {
    expect(problem(`${HEADER}\n \tsnack\tkg\t`)).toContain('Line 2')
  })

  it('refuses a file whose first line is not the header', () => {
    expect(problem('Dates\tsnack\tkg\t')).toContain('Line 1')
  })

  it('refuses an empty file rather than importing nothing', () => {
    expect(problem('   \n')).toBeDefined()
  })
})

describe('importing what was read', () => {
  it('adds what is new', async () => {
    const db = build()

    const done = await importPantry(
      db,
      [{ kind: 'spice', name: 'Cumin', unit: 'g', where: 'Spice shelf' }],
      () => new Date(NOW),
    )

    expect(done).toEqual({ added: 1, updated: 0 })
    const [row] = await db.select().from(pantryItem).where(eq(pantryItem.name, 'Cumin'))
    expect(row?.where).toBe('Spice shelf')
    expect(row?.created_at).toBe(NOW)
  })

  it('updates what is there already, matching the name whatever the capitals', async () => {
    const db = build()

    const done = await importPantry(
      db,
      [{ kind: 'breakfast', name: 'oatmeal', unit: 'kg', where: 'Hallway bucket' }],
      () => new Date(NOW),
    )

    expect(done).toEqual({ added: 0, updated: 1 })
    const rows = await db
      .select()
      .from(pantryItem)
      .where(sql`lower(${pantryItem.name}) = 'oatmeal'`)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('Oatmeal')
    expect(rows[0]?.where).toBe('Hallway bucket')
  })

  it('leaves the count alone, because a sheet knows nothing about what is in the house today', async () => {
    const db = build()
    const id = randomUUID()
    await db.insert(pantryItem).values({
      id,
      kind: 'spice',
      name: 'Cumin',
      unit: 'g',
      where: '',
      stock_level: 'some',
      stock_amount: 3,
      created_at: NOW,
    })

    await importPantry(
      db,
      [{ kind: 'spice', name: 'Cumin', unit: 'pkt', where: 'Spice shelf' }],
      () => new Date(NOW),
    )

    const [row] = await db.select().from(pantryItem).where(eq(pantryItem.id, id))
    expect(row?.unit).toBe('pkt')
    expect(row?.stock_level).toBe('some')
    expect(row?.stock_amount).toBe(3)
  })
})
