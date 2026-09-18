import type { StockLevel } from './enums.ts'

export interface Shoppable {
  name: string
  where: string
  unit: string
  stock_level: StockLevel | null
  stock_amount: number | null
  hearts: { count: number }
  bought: unknown
}

export interface ShoppingSections<T> {
  wanted: readonly T[]
  bought: readonly T[]
  enough: readonly T[]
}

export const byWanted = (a: Shoppable, b: Shoppable): number => {
  if (a.hearts.count !== b.hearts.count) return b.hearts.count - a.hearts.count

  const one = a.name.toLowerCase()
  const other = b.name.toLowerCase()

  return one < other ? -1 : one > other ? 1 : 0
}

export const shoppingSections = <T extends Shoppable>(items: readonly T[]): ShoppingSections<T> => {
  const hearted = items.filter((item) => item.hearts.count > 0).sort(byWanted)

  return {
    wanted: hearted.filter((item) => item.bought === null && item.stock_level !== 'plenty'),
    bought: hearted.filter((item) => item.bought !== null),
    enough: hearted.filter((item) => item.bought === null && item.stock_level === 'plenty'),
  }
}

export const wantedSaid = (count: number): string => `${count} want${count === 1 ? 's' : ''} it`

export const haveSaid = (item: Shoppable): string => {
  if (item.stock_level === null) return 'not counted'
  if (item.stock_level === 'plenty') return 'have plenty'
  if (item.stock_level === 'out') return 'have none'

  return item.stock_amount === null ? 'have some' : `have about ${item.stock_amount} ${item.unit}`
}

export const shoppingText = ({ wanted }: ShoppingSections<Shoppable>): string =>
  wanted
    .map((item) =>
      [
        '-',
        [item.name, wantedSaid(item.hearts.count), ...(item.where === '' ? [] : [item.where])].join(' · '),
      ].join(' '),
    )
    .join('\n')
