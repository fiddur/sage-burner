export interface PantryPlacing {
  place_id: string
  name: string
  spot: string
}

export const whereSaid = (places: readonly PantryPlacing[]): string =>
  places.map((one) => [one.name, one.spot.trim()].filter((part) => part !== '').join(' ')).join(' · ')

export const spotIn = (places: readonly PantryPlacing[], placeId: string): string | undefined =>
  places.find((one) => one.place_id === placeId)?.spot

export interface Spotted {
  name: string
  spot: string
}

const PARTS = /\d+|\D+/gu

const parts = (spot: string): (number | string)[] =>
  (spot.trim().toLowerCase().match(PARTS) ?? []).map((part) =>
    /^\d/u.test(part) ? Number(part) : part.trim(),
  )

const compare = (one: number | string, other: number | string): number => {
  if (typeof one === 'number' && typeof other === 'number') return one - other
  if (typeof one === 'number') return -1
  if (typeof other === 'number') return 1

  return one < other ? -1 : one > other ? 1 : 0
}

const byName = (one: Spotted, other: Spotted): number => {
  const [a, b] = [one.name.toLowerCase(), other.name.toLowerCase()]

  return a < b ? -1 : a > b ? 1 : 0
}

export const bySpot = (one: Spotted, other: Spotted): number => {
  const [here, there] = [one.spot.trim(), other.spot.trim()]
  if (here === '' || there === '') return here === there ? byName(one, other) : here === '' ? 1 : -1

  const [mine, yours] = [parts(here), parts(there)]

  for (let at = 0; at < Math.min(mine.length, yours.length); at += 1) {
    const step = compare(mine[at] ?? '', yours[at] ?? '')
    if (step !== 0) return step
  }

  return mine.length === yours.length ? byName(one, other) : mine.length - yours.length
}
