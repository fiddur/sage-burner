import type { ThreadEntityType } from './enums.ts'

export const whereItBelongs = (card: {
  burn: string | null
  entity_type: ThreadEntityType
}): string | undefined => card.burn ?? (card.entity_type === 'song' ? 'Songbook' : undefined)
