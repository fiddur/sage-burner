import type { PantryKind } from '@sage-burner/shared'

import { isPantryKind, pantryKinds } from '@sage-burner/shared'
import { and, eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Database } from './db/index.ts'

import { pantryItem, pantryItemPlace } from './db/schema.ts'

export interface PantryLine {
  name: string
  kind: PantryKind
  unit: string
  spots: { place_id: string; spot: string }[]
  need_more: boolean
}

export interface PantrySheet {
  lines: PantryLine[]
  places: KnownPlace[]
}

export type PantryReading = ({ kind: 'ok' } & PantrySheet) | { kind: 'bad'; problem: string }

export interface KnownPlace {
  id: string
  name: string
}

const HEADER = ['name', 'kind', 'unit'] as const

const NEED_MORE = 'need more'

const DEFAULT_UNIT = 'pcs'

const blank = (line: string): boolean => line.trim() === ''

type Columns = { kind: 'bad'; problem: string } | { kind: 'ok'; places: (KnownPlace | undefined)[] }

const headerColumns = (cells: readonly string[], places: readonly KnownPlace[], at: number): Columns => {
  const named = cells.map((cell) => cell.trim().toLowerCase())

  if (!HEADER.every((wanted, index) => named[index] === wanted)) {
    return {
      kind: 'bad',
      problem: `Line ${at}: the first line must begin ${HEADER.join('\t')}.`,
    }
  }

  const rest = named.slice(HEADER.length)
  const columns: (KnownPlace | undefined)[] = []

  for (const [index, column] of rest.entries()) {
    if (column === NEED_MORE && index === rest.length - 1) {
      columns.push(undefined)
      continue
    }

    const place = places.find((one) => one.name.trim().toLowerCase() === column)
    if (place === undefined) {
      const written = cells[HEADER.length + index]?.trim() ?? column

      return {
        kind: 'bad',
        problem: `Line ${at}: “${written}” is no room in the pantry. Add it under Pantry places, or rename the column.`,
      }
    }

    columns.push(place)
  }

  return { kind: 'ok', places: columns }
}

export const readPantryTsv = (text: string, places: readonly KnownPlace[]): PantryReading => {
  const rows = text.split(/\r?\n/u).map((line, index) => ({ at: index + 1, cells: line.split('\t'), line }))
  const [first, ...rest] = rows.filter((row) => !blank(row.line))

  if (first === undefined) return { kind: 'bad', problem: 'The file is empty.' }

  const header = headerColumns(first.cells, places, first.at)
  if (header.kind === 'bad') return header

  const width = HEADER.length + header.places.length
  const lines: PantryLine[] = []

  for (const { at, cells } of rest) {
    if (cells.length !== width) {
      return {
        kind: 'bad',
        problem: `Line ${at}: ${width} columns are wanted and ${cells.length} are here.`,
      }
    }

    const [name = '', kind = '', unit = '', ...rooms] = cells.map((cell) => cell.trim())

    if (name === '') return { kind: 'bad', problem: `Line ${at}: nothing is named here.` }
    if (!isPantryKind(kind)) {
      return { kind: 'bad', problem: `Line ${at}: “${kind}” is none of ${pantryKinds.join(', ')}.` }
    }

    const spots = header.places.flatMap((place, index) =>
      place === undefined || (rooms[index] ?? '') === ''
        ? []
        : [{ place_id: place.id, spot: rooms[index] ?? '' }],
    )

    const asked = header.places.findIndex((place) => place === undefined)

    lines.push({
      name,
      kind,
      unit: unit === '' ? DEFAULT_UNIT : unit,
      spots,
      need_more: asked !== -1 && (rooms[asked] ?? '') !== '',
    })
  }

  return { kind: 'ok', lines, places: header.places.filter((one) => one !== undefined) }
}

export interface PantryImport {
  added: number
  updated: number
}

export const importPantry = async (
  db: Database,
  sheet: PantrySheet,
  now: () => Date,
): Promise<PantryImport> => {
  let added = 0
  let updated = 0

  for (const { need_more, spots, ...fields } of sheet.lines) {
    const held = await db
      .select({ id: pantryItem.id, need_more_at: pantryItem.need_more_at })
      .from(pantryItem)
      .where(sql`lower(trim(${pantryItem.name})) = lower(trim(${fields.name}))`)
      .limit(1)

    const [existing] = held
    const asking = need_more ? { need_more_by: null, need_more_at: now().toISOString() } : {}
    const id = existing?.id ?? randomUUID()

    if (existing === undefined) {
      await db.insert(pantryItem).values({ ...fields, ...asking, id, created_at: now().toISOString() })
      added += 1
    } else {
      await db
        .update(pantryItem)
        .set({
          kind: fields.kind,
          unit: fields.unit,
          ...(existing.need_more_at === null ? asking : {}),
        })
        .where(sql`${pantryItem.id} = ${existing.id}`)
      updated += 1
    }

    for (const one of sheet.places) {
      await db
        .delete(pantryItemPlace)
        .where(and(eq(pantryItemPlace.item_id, id), eq(pantryItemPlace.place_id, one.id)))
    }

    if (spots.length > 0) {
      await db.insert(pantryItemPlace).values(spots.map((one) => ({ ...one, item_id: id })))
    }
  }

  return { added, updated }
}
