import type { CopySourcesResponse } from '@sage-burner/shared'

import { useState } from 'preact/hooks'

export type CopySource = CopySourcesResponse['sources'][number]

/**
 * "Or start from a previous burn" — the control both per-burn lists offer.
 *
 * The schema, the query and the CSS class were already shared; this was the last
 * copy, identical on the roles register and the places grid apart from three
 * strings. A fix to the disabled state or the empty-sources case would otherwise
 * have landed on one page and not the other.
 *
 * The caller renders it only while its list is empty, because the API refuses a
 * copy into one that is not — merging two is a decision nobody asked for.
 */
export const CopyFrom = ({
  sources,
  what,
  busy,
  onCopy,
}: {
  sources: readonly CopySource[]
  /** Plural, lowercase: "roles", "places". Fills the label, the button and the note. */
  what: string
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
    </div>
  )
}
