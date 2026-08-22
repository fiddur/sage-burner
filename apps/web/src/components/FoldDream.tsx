import type { Session } from '@sage-burner/shared'

import { useId, useState } from 'preact/hooks'

export const FoldDream = ({
  dream,
  others,
  busy,
  onFold,
}: {
  dream: Session
  others: readonly Session[]
  busy: boolean
  onFold: (into: string) => void
}) => {
  const [asking, setAsking] = useState(false)
  const [chosen, setChosen] = useState('')
  const noteId = useId()

  if (others.length === 0) return null

  if (!asking) {
    return (
      <button type="button" class="link-button" disabled={busy} onClick={() => setAsking(true)}>
        Fold into another dream…
      </button>
    )
  }

  const target = others.find((one) => one.id === chosen)

  return (
    <span class="fold-dream">
      <label class="field">
        <span>Which dream is this one part of?</span>
        <select
          aria-label={`Fold ${dream.title} into`}
          disabled={busy}
          value={chosen}
          onChange={(changeEvent) => setChosen(changeEvent.currentTarget.value)}
        >
          <option value="">Choose a dream</option>
          {others.map((one) => (
            <option key={one.id} value={one.id}>
              {one.title}
            </option>
          ))}
        </select>
      </label>

      {target !== undefined && (
        <span class="form-note" id={noteId}>
          Everything said on “{dream.title}” moves onto “{target.title}”, its helpers and hearts count there,
          and anyone following the talk follows it there. “{dream.title}” itself is withdrawn, and folding
          cannot be undone.
        </span>
      )}

      <span class="row">
        <button
          type="button"
          disabled={busy || target === undefined}
          {...(target === undefined ? {} : { 'aria-describedby': noteId })}
          onClick={() => {
            if (target === undefined) return
            setAsking(false)
            onFold(target.id)
          }}
        >
          Fold it in
        </button>
        <button type="button" class="link-button" disabled={busy} onClick={() => setAsking(false)}>
          Keep it apart
        </button>
      </span>
    </span>
  )
}
