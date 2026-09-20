import { Icon } from './Icon.tsx'

export const PantryNote = ({ what, note }: { what: string; note: string }) => {
  if (note.trim() === '') return null

  return (
    <details class="pantry-note">
      <summary aria-label={`About ${what}`}>
        <Icon name="info" />
      </summary>
      <span class="pantry-note-said">{note}</span>
    </details>
  )
}
