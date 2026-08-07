import type { MemberRosterEntry } from '@sage-burner/shared'

import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { ErrorText } from './ErrorText.tsx'

export type HandOverApi = Pick<ApiClient, 'getMembers' | 'transferMyPlace'>

/**
 * Handing your paid place to somebody on the waiting list (#23).
 *
 * The only way off a burn once you have paid: withdrawing is refused then, because
 * what a refund means is undecided, so before this a paid member who could not come
 * had no way to free their place.
 *
 * The list is fetched when the control is opened rather than with the page. Most
 * people never do this, and a roster per burn on every visit to buy nothing is the
 * wrong trade.
 *
 * Asks before doing it, unlike most controls here: this one takes you off the burn
 * and cannot be undone from either side.
 */
export const HandOverPlace = ({
  api,
  eventId,
  myAccountId,
  onDone,
}: {
  api: HandOverApi
  eventId: string
  myAccountId: string | undefined
  onDone: () => void
}) => {
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<readonly MemberRosterEntry[] | undefined>(undefined)
  const [chosen, setChosen] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const openPicker = async () => {
    setOpen(true)
    setError(undefined)
    // Dropped, or *Never mind* then reopening renders the list fetched last time
    // until this one lands, with whoever has paid since still on it (#263).
    setCandidates(undefined)
    try {
      const { entries } = await api.getMembers(eventId)
      setCandidates(entries.filter((entry) => entry.payment_status !== 'paid'))
    } catch {
      setError('Could not fetch who is waiting. Please try again.')
    }
  }

  const handOver = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await api.transferMyPlace(eventId, { to_account_id: chosen })
      onDone()
    } catch {
      setError('Could not hand the place over. They may have paid in the meantime.')
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <p class="row">
        <button type="button" class="link-button" onClick={() => void openPicker()}>
          Hand my place to somebody else
        </button>
      </p>
    )
  }

  return (
    <div class="notice">
      <p class="form-note">
        Settle the money between you first — this only moves the place. You come off the burn, and everything
        you signed up for here goes with it.
      </p>

      <ErrorText message={error} />

      {candidates === undefined && error === undefined && <p class="form-note">One moment…</p>}

      {/* Not "nobody is waiting": the offer is to everybody here who has not paid,
          which includes members above the line — an unpaid member is exactly who you
          might hand a place to, since paying is what secures one (#263). */}
      {candidates?.length === 0 && <p>Everybody at this burn has paid, so there is nobody to hand it to.</p>}

      {candidates !== undefined && candidates.length > 0 && (
        <p class="row">
          <label class="field">
            <span>Who takes it</span>
            <select value={chosen} onChange={(pick) => setChosen(pick.currentTarget.value)}>
              <option value="">Choose somebody…</option>
              {candidates
                .filter((entry) => entry.account_id !== myAccountId)
                .map((entry) => (
                  <option key={entry.account_id} value={entry.account_id}>
                    {entry.name ?? 'Name not filled in yet'}
                  </option>
                ))}
            </select>
          </label>

          <button type="button" disabled={busy || chosen === ''} onClick={() => void handOver()}>
            {busy ? 'Handing it over…' : 'Hand it over'}
          </button>
        </p>
      )}

      <p class="row">
        <button type="button" class="link-button" onClick={() => setOpen(false)}>
          Never mind
        </button>
      </p>
    </div>
  )
}
