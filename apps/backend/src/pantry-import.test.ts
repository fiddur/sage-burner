import { MAX_PANTRY_NOTE } from '@sage-burner/shared'
import { and, eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbHandle } from './db/index.ts'
import type { KnownPlace, PantryLine } from './pantry-import.ts'

import { createDb, runMigrations } from './db/index.ts'
import { pantryItem, pantryItemPlace } from './db/schema.ts'
import { importPantry, readPantryTsv } from './pantry-import.ts'
import { pantryPlacesFor } from './pantry-places.ts'

const NOW = '2026-09-18T10:00:00.000Z'

const CELLAR = 'fa0d0001-0000-4000-8000-000000000003'
const HALLWAY = 'fa0d0001-0000-4000-8000-000000000002'

const ROOMS: KnownPlace[] = [
  { id: HALLWAY, name: 'Hallway' },
  { id: CELLAR, name: 'Cellar' },
]

const HEADER = 'name\tkind\tunit\tHallway\tCellar'
const WIDER = `${HEADER}\tneed more`
const NOTED = `${HEADER}\tnote`

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

const lines = (text: string, places: readonly KnownPlace[] = ROOMS) => {
  const reading = readPantryTsv(text, places)
  if (reading.kind !== 'ok') throw new Error(reading.problem)

  return reading.lines
}

const problem = (text: string, places: readonly KnownPlace[] = ROOMS) => {
  const reading = readPantryTsv(text, places)

  return reading.kind === 'bad' ? reading.problem : undefined
}

const sheet = (rows: readonly PantryLine[], places: readonly KnownPlace[] = ROOMS) => ({
  lines: [...rows],
  places: [...places],
})

const aLine = (over: Partial<PantryLine> = {}): PantryLine => ({
  kind: 'staple',
  name: 'Rice',
  unit: 'kg',
  note: '',
  spots: [],
  need_more: false,
  ...over,
})

const spotsOf = async (db: ReturnType<typeof build>, itemId: string) =>
  await db
    .select({ place_id: pantryItemPlace.place_id, spot: pantryItemPlace.spot })
    .from(pantryItemPlace)
    .where(eq(pantryItemPlace.item_id, itemId))

describe('reading a sheet somebody exported', () => {
  it('takes a header and the rows under it, a cell under a room being the box in it', () => {
    expect(lines(`${HEADER}\nOatmeal\tbreakfast\tkg\tbucket\tI`)).toEqual([
      {
        kind: 'breakfast',
        name: 'Oatmeal',
        unit: 'kg',
        spots: [
          { place_id: HALLWAY, spot: 'bucket' },
          { place_id: CELLAR, spot: 'I' },
        ],
        note: '',
        need_more: false,
      },
    ])
  })

  it('matches a column to a room whatever the capitals', () => {
    expect(lines(`name\tkind\tunit\tCELLAR\nRice\tstaple\tkg\tR2`)[0]?.spots).toEqual([
      { place_id: CELLAR, spot: 'R2' },
    ])
  })

  it('reads an empty cell as “not in that room”', () => {
    expect(lines(`${HEADER}\nRice\tstaple\tkg\t\tR2`)[0]?.spots).toEqual([{ place_id: CELLAR, spot: 'R2' }])
  })

  it('refuses a column naming no room, and names the column', () => {
    expect(problem(`name\tkind\tunit\tAttic\nRice\tstaple\tkg\tR2`)).toContain('Attic')
  })

  it('takes a sheet with no room columns at all', () => {
    expect(lines('name\tkind\tunit\nRice\tstaple\tkg')[0]?.spots).toEqual([])
  })

  it('steps over blank lines, which every exported sheet has', () => {
    expect(lines(`\n${HEADER}\n\nDates\tsnack\tkg\t\t\n\n`)).toEqual([
      { kind: 'snack', name: 'Dates', unit: 'kg', note: '', spots: [], need_more: false },
    ])
  })

  it('counts an unnamed unit as pieces, the way the form does', () => {
    expect(lines(`${HEADER}\nToilet paper\thousehold\t\t\t`)[0]?.unit).toBe('pcs')
  })

  it('names the line a kind nobody knows is on', () => {
    expect(problem(`${HEADER}\nDates\tsnack\tkg\t\t\nCumin\tpudding\tg\t\t`)).toContain('Line 3')
  })

  it('names the line a column is missing from', () => {
    expect(problem(`${HEADER}\nDates\tsnack`)).toContain('Line 2')
  })

  it('refuses a line with nothing named on it', () => {
    expect(problem(`${HEADER}\n \tsnack\tkg\t\t`)).toContain('Line 2')
  })

  it('takes a last column saying more is needed, and reads any word in it as yes', () => {
    expect(lines(`${WIDER}\nRice\tstaple\tkg\t\tI\tx`)[0]?.need_more).toBe(true)
  })

  it('reads an empty last cell as saying nothing', () => {
    expect(lines(`${WIDER}\nRice\tstaple\tkg\t\tI\t `)[0]?.need_more).toBe(false)
  })

  it('wants the last cell on every line once the header names it', () => {
    expect(problem(`${WIDER}\nRice\tstaple\tkg\t\tI`)).toContain('Line 2')
  })

  it('takes an optional note column, and leaves it empty where the header has none', () => {
    expect(lines(`${NOTED}\nRice\tstaple\tkg\t\tI\tDry weight`)[0]?.note).toBe('Dry weight')
    expect(lines(`${HEADER}\nRice\tstaple\tkg\t\tI`)[0]?.note).toBe('')
  })

  it('reads a note and an ask on one sheet, in whichever order the columns come', () => {
    const both = `${HEADER}\tnote\tneed more\nRice\tstaple\tkg\t\tI\tDry weight\tx`

    expect(lines(both)[0]).toMatchObject({ note: 'Dry weight', need_more: true })
  })

  it('refuses a note longer than a note may be, and names the line and the length', () => {
    expect(problem(`${NOTED}\nRice\tstaple\tkg\t\tI\t${'n'.repeat(MAX_PANTRY_NOTE + 1)}`)).toBe(
      `Line 2: the note is ${MAX_PANTRY_NOTE + 1} characters, and ${MAX_PANTRY_NOTE} is the most.`,
    )
  })

  it('takes a note exactly as long as a note may be', () => {
    expect(lines(`${NOTED}\nRice\tstaple\tkg\t\tI\t${'n'.repeat(MAX_PANTRY_NOTE)}`)[0]?.note).toHaveLength(
      MAX_PANTRY_NOTE,
    )
  })

  it('refuses a file whose first line is not the header', () => {
    expect(problem('Dates\tsnack\tkg\t')).toContain('Line 1')
  })

  it('refuses an empty file rather than importing nothing', () => {
    expect(problem('   \n')).toBeDefined()
  })
})

describe('importing what was read', () => {
  it('adds what is new, in the rooms the sheet put it in', async () => {
    const db = build()

    const done = await importPantry(
      db,
      sheet([aLine({ kind: 'spice', name: 'Cumin', unit: 'g', spots: [{ place_id: CELLAR, spot: 'R2' }] })]),
      () => new Date(NOW),
    )

    expect(done).toEqual({ added: 1, updated: 0 })
    const [row] = await db.select().from(pantryItem).where(eq(pantryItem.name, 'Cumin'))
    expect(row?.created_at).toBe(NOW)
    expect(await spotsOf(db, row?.id ?? '')).toEqual([{ place_id: CELLAR, spot: 'R2' }])
  })

  it('updates what is there already, matching the name whatever the capitals', async () => {
    const db = build()

    const done = await importPantry(
      db,
      sheet([
        aLine({
          kind: 'breakfast',
          name: 'oatmeal',
          spots: [{ place_id: HALLWAY, spot: 'bucket' }],
        }),
      ]),
      () => new Date(NOW),
    )

    expect(done).toEqual({ added: 0, updated: 1 })
    const rows = await db
      .select()
      .from(pantryItem)
      .where(sql`lower(${pantryItem.name}) = 'oatmeal'`)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('Oatmeal')
    expect(await spotsOf(db, rows[0]?.id ?? '')).toEqual([{ place_id: HALLWAY, spot: 'bucket' }])
  })

  it('takes a thing out of a room the sheet names and leaves it empty for', async () => {
    const db = build()
    const id = randomUUID()
    await db.insert(pantryItem).values({ id, kind: 'staple', name: 'Rice', unit: 'kg', created_at: NOW })
    await db.insert(pantryItemPlace).values([
      { item_id: id, place_id: HALLWAY, spot: 'bucket' },
      { item_id: id, place_id: CELLAR, spot: 'I' },
    ])

    await importPantry(db, sheet([aLine({ spots: [{ place_id: CELLAR, spot: 'R2' }] })]), () => new Date(NOW))

    expect(await spotsOf(db, id)).toEqual([{ place_id: CELLAR, spot: 'R2' }])
  })

  it('leaves a room the header never named alone', async () => {
    const db = build()
    const id = randomUUID()
    await db.insert(pantryItem).values({ id, kind: 'staple', name: 'Rice', unit: 'kg', created_at: NOW })
    await db.insert(pantryItemPlace).values({ item_id: id, place_id: HALLWAY, spot: 'bucket' })

    await importPantry(
      db,
      sheet([aLine({ spots: [{ place_id: CELLAR, spot: 'R2' }] })], [{ id: CELLAR, name: 'Cellar' }]),
      () => new Date(NOW),
    )

    expect(
      await db
        .select({ spot: pantryItemPlace.spot })
        .from(pantryItemPlace)
        .where(and(eq(pantryItemPlace.item_id, id), eq(pantryItemPlace.place_id, HALLWAY))),
    ).toEqual([{ spot: 'bucket' }])
  })

  it('leaves the count alone, because a sheet knows nothing about what is in the house today', async () => {
    const db = build()
    const id = randomUUID()
    await db.insert(pantryItem).values({
      id,
      kind: 'spice',
      name: 'Cumin',
      unit: 'g',
      stock_level: 'some',
      stock_amount: 3,
      created_at: NOW,
    })

    await importPantry(db, sheet([aLine({ kind: 'spice', name: 'Cumin', unit: 'pkt' })]), () => new Date(NOW))

    const [row] = await db.select().from(pantryItem).where(eq(pantryItem.id, id))
    expect(row?.unit).toBe('pkt')
    expect(row?.stock_level).toBe('some')
    expect(row?.stock_amount).toBe(3)
  })

  it('flags a thing the sheet asks for, naming nobody', async () => {
    const db = build()

    await importPantry(db, sheet([aLine({ need_more: true })]), () => new Date(NOW))

    const [row] = await db.select().from(pantryItem).where(eq(pantryItem.name, 'Rice'))
    expect(row?.need_more_at).toBe(NOW)
    expect(row?.need_more_by).toBeNull()
  })

  it('writes the note the sheet carries onto a row it adds', async () => {
    const db = build()

    await importPantry(db, sheet([aLine({ note: 'Dry weight' })]), () => new Date(NOW))

    const [row] = await db.select().from(pantryItem).where(eq(pantryItem.name, 'Rice'))
    expect(row?.note).toBe('Dry weight')
  })

  it('writes a note onto a row already there, and an empty cell leaves the one it has', async () => {
    const db = build()
    const id = randomUUID()
    await db
      .insert(pantryItem)
      .values({ id, kind: 'staple', name: 'Rice', unit: 'kg', note: 'Dry weight', created_at: NOW })

    await importPantry(db, sheet([aLine()]), () => new Date(NOW))
    expect((await db.select().from(pantryItem).where(eq(pantryItem.id, id)))[0]?.note).toBe('Dry weight')

    await importPantry(db, sheet([aLine({ note: '0.09 kg is ca 2.5 dl' })]), () => new Date(NOW))
    expect((await db.select().from(pantryItem).where(eq(pantryItem.id, id)))[0]?.note).toBe(
      '0.09 kg is ca 2.5 dl',
    )
  })

  it('leaves a flag already on a row alone, whoever asked for it', async () => {
    const db = build()
    const id = randomUUID()
    const asked = '2026-09-17T08:00:00.000Z'
    await db.insert(pantryItem).values({
      id,
      kind: 'staple',
      name: 'Rice',
      unit: 'kg',
      need_more_at: asked,
      created_at: asked,
    })

    await importPantry(db, sheet([aLine({ need_more: true })]), () => new Date(NOW))

    const [row] = await db.select().from(pantryItem).where(eq(pantryItem.id, id))
    expect(row?.need_more_at).toBe(asked)
  })

  it('leaves an unasked-for row unflagged, and one flag alone, when the cell is empty', async () => {
    const db = build()
    const id = randomUUID()
    await db.insert(pantryItem).values({
      id,
      kind: 'staple',
      name: 'Rice',
      unit: 'kg',
      need_more_at: NOW,
      created_at: NOW,
    })

    await importPantry(db, sheet([aLine(), aLine({ name: 'Lentils' })]), () => new Date(NOW))

    const [rice] = await db.select().from(pantryItem).where(eq(pantryItem.id, id))
    const [lentils] = await db.select().from(pantryItem).where(eq(pantryItem.name, 'Lentils'))
    expect(rice?.need_more_at).toBe(NOW)
    expect(lentils?.need_more_at).toBeNull()
  })

  it('reads the rooms the migration seeded, which is what the CLI hands it', async () => {
    const db = build()

    expect((await pantryPlacesFor(db)).map((one) => one.name)).toEqual([
      'Kitchen',
      'Hallway',
      'Cellar',
      'Party kitchen',
    ])
  })
})
