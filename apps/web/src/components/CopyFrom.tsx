import type { CopySourcesResponse } from '@sage-burner/shared'

import { useState } from 'preact/hooks'

export type CopySource = CopySourcesResponse['sources'][number]

/**
 * "Or start from a previous burn" — the control both per-burn lists offer.
 *
 * One control, three lists — the roles register, the places grid and the FAQ — which
 * differ by three strings. A fix to the disabled state or the empty-sources case
 * otherwise lands on one of them and not the others.
 *
 * The caller renders it only while its list is empty, because the API refuses a
 * copy into one that is not — merging two is a decision nobody asked for.
 */
export const CopyFrom = ({
  sources,
  what,
  note,
  busy,
  onCopy,
}: {
  sources: readonly CopySource[]
  /** Plural, lowercase: "roles", "places". Fills the label and the button. */
  what: string
  /**
   * What is *not* copied. Not derivable from `what` and worth saying at the button:
   * both lists carry people, and neither brings them across.
   */
  note: string
  busy: boolean
  onCopy: (fromEventId: string) => void
}) => {
  const [chosen, setChosen] = useState(sources[0]?.event_id ?? '')

  return (
    <div class="copy-from">
      <label class="field">
        <span>Or start from a previous burn</span>
        <select
          aria-label={`Burn to copy ${what} from`}
          disabled={busy}
          value={chosen}
          onChange={(changeEvent) => setChosen(changeEvent.currentTarget.value)}
        >
          {sources.map((source) => (
            <option key={source.event_id} value={source.event_id}>
              {source.name} ({source.count})
            </option>
          ))}
        </select>
      </label>

      <button type="button" disabled={busy || chosen === ''} onClick={() => onCopy(chosen)}>
        Copy those {what}
      </button>

      <p class="form-note">{note}</p>
    </div>
  )
}
