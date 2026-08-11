import { isLit, litAfterTap } from '../chips.ts'

export interface Chip<T extends string> {
  id: T
  label: string
}

export const ChipRow = <T extends string>({
  chips,
  lit,
  subject,
  onChange,
}: {
  chips: readonly Chip<T>[]
  lit: readonly T[]
  subject: string
  onChange: (lit: T[]) => void
}) => {
  if (chips.length === 0) return null

  const all = chips.map((chip) => chip.id)

  return (
    <p class="chip-row" role="group" aria-label={subject}>
      <button
        type="button"
        class={lit.length === 0 ? 'chip is-on' : 'chip'}
        aria-pressed={lit.length === 0}
        onClick={() => onChange([])}
      >
        Everything
      </button>
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          class={isLit(lit, chip.id) ? 'chip is-on' : 'chip'}
          aria-pressed={isLit(lit, chip.id)}
          onClick={() => onChange(litAfterTap(all, lit, chip.id))}
        >
          {chip.label}
        </button>
      ))}
    </p>
  )
}
