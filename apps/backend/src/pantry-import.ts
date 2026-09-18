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
  need_more: boolean
}

export type PantryReading = { kind: 'bad'; problem: string } | { kind: 'ok'; lines: PantryLine[] }

const HEADER = ['name', 'kind', 'unit', 'where'] as const

const NEED_MORE = 'need more'

const DEFAULT_UNIT = 'pcs'

const blank = (line: string): boolean => line.trim() === ''

const headerWidth = (cells: readonly string[]): number | undefined => {
  const named = cells.map((cell) => cell.trim().toLowerCase())

  if (!HEADER.every((wanted, index) => named[index] === wanted)) return undefined
  if (named.length === HEADER.length) return HEADER.length

  return named.length === HEADER.length + 1 && named[HEADER.length] === NEED_MORE ? named.length : undefined
}

export const readPantryTsv = (text: string): PantryReading => {
  const rows = text.split(/\r?\n/u).map((line, index) => ({ at: index + 1, cells: line.split('\t'), line }))
  const [first, ...rest] = rows.filter((row) => !blank(row.line))

  if (first === undefined) return { kind: 'bad', problem: 'The file is empty.' }

  const width = headerWidth(first.cells)

  if (width === undefined) {
    return {
      kind: 'bad',
      problem: `Line ${first.at}: the first line must be ${HEADER.join('\t')}, and may end with ${NEED_MORE}.`,
    }
  }

  const lines: PantryLine[] = []

  for (const { at, cells } of rest) {
    if (cells.length !== width) {
      return {
        kind: 'bad',
        problem: `Line ${at}: ${width} columns are wanted and ${cells.length} are here.`,
      }
    }

    const [name = '', kind = '', unit = '', where = '', more = ''] = cells.map((cell) => cell.trim())

    if (name === '') return { kind: 'bad', problem: `Line ${at}: nothing is named here.` }
    if (!isPantryKind(kind)) {
      return { kind: 'bad', problem: `Line ${at}: “${kind}” is none of ${pantryKinds.join(', ')}.` }
    }

    lines.push({ name, kind, unit: unit === '' ? DEFAULT_UNIT : unit, where, need_more: more !== '' })
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

  for (const { need_more, ...fields } of lines) {
    const held = await db
      .select({ id: pantryItem.id, need_more_at: pantryItem.need_more_at })
      .from(pantryItem)
      .where(sql`lower(trim(${pantryItem.name})) = lower(trim(${fields.name}))`)
      .limit(1)

    const [existing] = held
    const asking = need_more ? { need_more_by: null, need_more_at: now().toISOString() } : {}

    if (existing === undefined) {
      await db
        .insert(pantryItem)
        .values({ ...fields, ...asking, id: randomUUID(), created_at: now().toISOString() })
      added += 1
    } else {
      await db
        .update(pantryItem)
        .set({
          kind: fields.kind,
          unit: fields.unit,
          where: fields.where,
          ...(existing.need_more_at === null ? asking : {}),
        })
        .where(sql`${pantryItem.id} = ${existing.id}`)
      updated += 1
    }
  }

  return { added, updated }
}
