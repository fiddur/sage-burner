import type { CopySourcesResponse } from '@sage-burner/shared'

import { useState } from 'preact/hooks'

export type CopySource = CopySourcesResponse['sources'][number]

export const CopyFrom = ({
  sources,
  what,
  note,
  busy,
  onCopy,
}: {
  sources: readonly CopySource[]
  what: string
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
