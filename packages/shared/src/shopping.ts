import type { StockLevel } from './enums.ts'
import type { Placeable } from './roster.ts'

import { dayName } from './dates.ts'
import { withPlaces } from './roster.ts'

export interface Ticked {
  by: string | null
  by_name: string | null
  at: string
}

export interface Shoppable {
  id: string
  name: string
  where: string
  unit: string
  stock_level: StockLevel | null
  stock_amount: number | null
  hearts: { count: number }
  bought: Ticked | null
}

export interface Staying extends Placeable {
  arrival_date: string | null
  departure_date: string | null
}

export interface SittingLine {
  id: string
  pantry_item_id: string | null
  name: string
  unit: string
  amount: number | null
  bought: Ticked | null
}

export interface Sitting {
  label: string
  date: string
  serves: number
  lead: { name: string | null } | null
  ingredients: readonly SittingLine[]
}

export interface Use {
  label: string
  date: string
  amount: number | null
  cook: string | null
}

export interface ShoppingRow {
  key: string
  name: string
  unit: string
  where: string
  stock_level: StockLevel | null
  stock_amount: number | null
  hearts: number
  need: number | null
  buy: number | null
  used_in: readonly Use[]
  pantry_item_id: string | null
  ingredient_ids: readonly string[]
  bought: Ticked | null
}

export interface ShoppingSections {
  pantry: readonly ShoppingRow[]
  special: readonly ShoppingRow[]
  bought: readonly ShoppingRow[]
  enough: readonly ShoppingRow[]
}

export interface ShoppingInput {
  items: readonly Shoppable[]
  sittings: readonly Sitting[]
  entries: readonly Staying[]
  cap: number
  buying_for: number | null
}

const byName = (one: string, other: string): number =>
  one.toLowerCase() < other.toLowerCase() ? -1 : one.toLowerCase() > other.toLowerCase() ? 1 : 0

export interface Hearted {
  name: string
  hearts: { count: number }
}

export const byWanted = (a: Hearted, b: Hearted): number =>
  a.hearts.count === b.hearts.count ? byName(a.name, b.name) : b.hearts.count - a.hearts.count

export const staysOver = (entry: Staying, date: string): boolean =>
  (entry.arrival_date === null || entry.arrival_date <= date) &&
  (entry.departure_date === null || entry.departure_date >= date)

export const headcountOn = (entries: readonly Staying[], cap: number, date: string): number =>
  withPlaces(entries, cap).filter((entry) => !entry.waiting && staysOver(entry, date)).length

export const scaled = (amount: number, serves: number, heads: number): number => (amount * heads) / serves

const TENTHS = ['kg', 'l']

export const roundUp = (amount: number, unit: string): number => {
  const step = TENTHS.includes(unit.trim().toLowerCase()) ? 10 : 1
  const steps = Math.ceil(amount * step - 1e-9)

  return steps === 0 ? 0 : steps / step
}

export const wantedSaid = (count: number): string => `${count} want${count === 1 ? 's' : ''} it`

export const haveSaid = (item: {
  stock_level: StockLevel | null
  stock_amount: number | null
  unit: string
}): string => {
  if (item.stock_level === null) return 'not counted'
  if (item.stock_level === 'plenty') return 'have plenty'
  if (item.stock_level === 'out') return 'have none'

  return item.stock_amount === null ? 'have some' : `have about ${item.stock_amount} ${item.unit}`
}

export const usedSaid = (use: Use, unit: string): string =>
  [
    `${dayName(use.date, 'short')} ${use.label}`,
    ...(use.amount === null ? [] : [`${use.amount} ${unit}`]),
  ].join(' ') + (use.cook === null ? '' : ` · ${use.cook}`)

export const askedSaid = (row: ShoppingRow): string =>
  [
    ...row.used_in.map((use) => usedSaid(use, row.unit)),
    ...(row.hearts === 0 ? [] : [wantedSaid(row.hearts)]),
  ].join(' · ')

export const placesSaid = (entries: readonly Staying[], cap: number, dates: readonly string[]): string => {
  const placed = withPlaces(entries, cap).filter((entry) => !entry.waiting).length
  const days = [...new Set(dates)]
    .sort()
    .map((date) => `${headcountOn(entries, cap, date)} here on ${dayName(date)}`)

  return [`${placed} have a place`, ...(days.length === 0 ? [] : [days.join(', ')])].join('; ')
}

interface Gathered {
  sum: number
  counted: boolean
  used_in: Use[]
  ids: string[]
  ticks: (Ticked | null)[]
  name: string
  unit: string
}

const specialKey = (line: SittingLine): string =>
  `${line.name.trim().toLowerCase()} · ${line.unit.trim().toLowerCase()}`

const gather = (input: ShoppingInput) => {
  const heads = new Map<string, number>()
  const picks = new Map<string, Gathered>()
  const specials = new Map<string, Gathered>()

  const headsOn = (date: string): number => {
    const known = heads.get(date)
    if (known !== undefined) return known

    const found = input.buying_for ?? headcountOn(input.entries, input.cap, date)
    heads.set(date, found)

    return found
  }

  for (const sitting of input.sittings) {
    for (const line of sitting.ingredients) {
      const into = line.pantry_item_id === null ? specials : picks
      const key = line.pantry_item_id ?? specialKey(line)
      const so_far = into.get(key) ?? {
        sum: 0,
        counted: false,
        used_in: [],
        ids: [],
        ticks: [],
        name: line.name,
        unit: line.unit,
      }

      const amount = line.amount === null ? null : scaled(line.amount, sitting.serves, headsOn(sitting.date))

      into.set(key, {
        ...so_far,
        sum: so_far.sum + (amount ?? 0),
        counted: so_far.counted || amount !== null,
        used_in: [
          ...so_far.used_in,
          {
            label: sitting.label,
            date: sitting.date,
            amount: amount === null ? null : roundUp(amount, line.unit),
            cook: sitting.lead?.name ?? null,
          },
        ],
        ids: [...so_far.ids, line.id],
        ticks: [...so_far.ticks, line.bought],
      })
    }
  }

  return { picks, specials }
}

const held = (item: Shoppable, wanted: number): number => {
  if (item.stock_level === 'plenty') return wanted
  if (item.stock_level === 'some') return item.stock_amount ?? 0

  return 0
}

const byNeeded = (a: ShoppingRow, b: ShoppingRow): number => {
  const cooked = Number(b.used_in.length > 0) - Number(a.used_in.length > 0)
  if (cooked !== 0) return cooked
  if (a.hearts !== b.hearts) return b.hearts - a.hearts

  return byName(a.name, b.name)
}

const newest = (ticks: readonly Ticked[]): Ticked | null =>
  ticks.reduce<Ticked | null>(
    (latest, tick) => (latest === null || tick.at > latest.at ? tick : latest),
    null,
  )

const specialRow = (key: string, gathered: Gathered): ShoppingRow => {
  const ticks = gathered.ticks.filter((tick) => tick !== null)

  return {
    key,
    name: gathered.name,
    unit: gathered.unit,
    where: '',
    stock_level: null,
    stock_amount: null,
    hearts: 0,
    need: gathered.counted ? roundUp(gathered.sum, gathered.unit) : null,
    buy: gathered.counted ? roundUp(gathered.sum, gathered.unit) : null,
    used_in: gathered.used_in,
    pantry_item_id: null,
    ingredient_ids: gathered.ids,
    bought: ticks.length === gathered.ticks.length ? newest(ticks) : null,
  }
}

const pantryRow = (item: Shoppable, gathered: Gathered | undefined): ShoppingRow => {
  const wanted = gathered?.counted === true ? gathered.sum : null
  const have = held(item, wanted ?? 0)

  return {
    key: item.id,
    name: item.name,
    unit: item.unit,
    where: item.where,
    stock_level: item.stock_level,
    stock_amount: item.stock_amount,
    hearts: item.hearts.count,
    need: wanted === null ? null : roundUp(wanted, item.unit),
    buy: wanted === null ? null : roundUp(Math.max(0, wanted - have), item.unit),
    used_in: gathered?.used_in ?? [],
    pantry_item_id: item.id,
    ingredient_ids: [],
    bought: item.bought,
  }
}

export const shoppingSections = (input: ShoppingInput): ShoppingSections => {
  const { picks, specials } = gather(input)
  const stocked = new Set(input.items.map((item) => item.id))

  const rows = input.items
    .filter((item) => item.hearts.count > 0 || picks.has(item.id))
    .map((item) => pantryRow(item, picks.get(item.id)))

  const asked = [...specials, ...[...picks].filter(([key]) => !stocked.has(key))].map(([key, gathered]) =>
    specialRow(key, gathered),
  )

  const enough = (row: ShoppingRow): boolean => row.stock_level === 'plenty' || row.buy === 0

  return {
    pantry: rows.filter((row) => row.bought === null && !enough(row)).sort(byNeeded),
    special: asked.filter((row) => row.bought === null).sort(byNeeded),
    bought: [...rows, ...asked].filter((row) => row.bought !== null).sort(byNeeded),
    enough: rows.filter((row) => row.bought === null && enough(row)).sort(byNeeded),
  }
}

export const buySaid = (row: ShoppingRow): string => (row.buy === null ? '' : `${row.buy} ${row.unit}`)

export const shoppingText = (sections: ShoppingSections): string =>
  [...sections.pantry, ...sections.special]
    .map(
      (row) =>
        `- ${[row.name, buySaid(row), askedSaid(row), row.where].filter((part) => part !== '').join(' · ')}`,
    )
    .join('\n')
