import type { PantryKind } from '@sage-burner/shared'

import { isPantryKind, pantryKinds } from '@sage-burner/shared'
import { sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import type { Database } from './db/index.ts'

import { pantryItem } from './db/schema.ts'

export interface PantryLine {
  name: string
  kind: PantryKind
  unit: string
  where: string
}

export type PantryReading = { kind: 'bad'; problem: string } | { kind: 'ok'; lines: PantryLine[] }

const HEADER = ['name', 'kind', 'unit', 'where'] as const

const DEFAULT_UNIT = 'pcs'

const blank = (line: string): boolean => line.trim() === ''

const isHeader = (cells: readonly string[]): boolean =>
  cells.length === HEADER.length &&
  HEADER.every((wanted, index) => cells[index]?.trim().toLowerCase() === wanted)

export const readPantryTsv = (text: string): PantryReading => {
  const rows = text.split(/\r?\n/u).map((line, index) => ({ at: index + 1, cells: line.split('\t'), line }))
  const [first, ...rest] = rows.filter((row) => !blank(row.line))

  if (first === undefined) return { kind: 'bad', problem: 'The file is empty.' }
  if (!isHeader(first.cells)) {
    return { kind: 'bad', problem: `Line ${first.at}: the first line must be ${HEADER.join('\t')}.` }
  }

  const lines: PantryLine[] = []

  for (const { at, cells } of rest) {
    if (cells.length !== HEADER.length) {
      return {
        kind: 'bad',
        problem: `Line ${at}: ${HEADER.length} columns are wanted and ${cells.length} are here.`,
      }
    }

    const [name = '', kind = '', unit = '', where = ''] = cells.map((cell) => cell.trim())

    if (name === '') return { kind: 'bad', problem: `Line ${at}: nothing is named here.` }
    if (!isPantryKind(kind)) {
      return { kind: 'bad', problem: `Line ${at}: “${kind}” is none of ${pantryKinds.join(', ')}.` }
    }

    lines.push({ name, kind, unit: unit === '' ? DEFAULT_UNIT : unit, where })
  }

  return { kind: 'ok', lines }
}

export interface PantryImport {
  added: number
  updated: number
}

export const importPantry = async (
  db: Database,
  lines: readonly PantryLine[],
  now: () => Date,
): Promise<PantryImport> => {
  let added = 0
  let updated = 0

  for (const line of lines) {
    const held = await db
      .select({ id: pantryItem.id })
      .from(pantryItem)
      .where(sql`lower(trim(${pantryItem.name})) = lower(trim(${line.name}))`)
      .limit(1)

    const [existing] = held

    if (existing === undefined) {
      await db.insert(pantryItem).values({ ...line, id: randomUUID(), created_at: now().toISOString() })
      added += 1
    } else {
      await db
        .update(pantryItem)
        .set({ kind: line.kind, unit: line.unit, where: line.where })
        .where(sql`${pantryItem.id} = ${existing.id}`)
      updated += 1
    }
  }

  return { added, updated }
}
