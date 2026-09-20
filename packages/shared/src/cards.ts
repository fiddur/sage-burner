import type { RideKind, ThreadEntityType } from './enums.ts'

export const whereItBelongs = (card: {
  burn: string | null
  entity_type: ThreadEntityType
}): string | undefined => card.burn ?? (card.entity_type === 'song' ? 'Songbook' : undefined)

export const rideTitle = (ride: { kind: RideKind; from: string }): string =>
  ride.kind === 'offers' ? `Offering a lift from ${ride.from}` : `Looking for a lift from ${ride.from}`

export const rideBody = (ride: { kind: RideKind; when: string; seats: number; notes: string }): string => {
  const line = ride.kind === 'offers' && ride.seats > 0 ? `${ride.when} · ${ride.seats} seats` : ride.when

  return ride.notes.trim() === '' ? line : `${line}\n\n${ride.notes}`
}
