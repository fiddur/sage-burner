import type { RosterEntry, RosterResponse } from '@sage-burner/shared'

import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { toCsv } from '../csv.ts'
import { isAdmin, useViewer } from '../viewer.tsx'

export type RosterApi = Pick<ApiClient, 'getActiveRoster' | 'setPayment'>

type Loaded = { status: 'loading' } | { status: 'ready'; roster: RosterResponse } | { status: 'failed' }

const COLUMNS = [
  'name',
  'email',
  'contact',
  'allergies_notes',
  'arrival_date',
  'departure_date',
  'lodging',
  'shift_preference',
  'notes',
  'payment_status',
  'payment_date',
  'waiting',
] as const

const download = (name: string, csv: string) => {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export const AdminRoster = ({ api }: { api: RosterApi }) => {
  const viewer = useViewer()
  const admin = isAdmin(viewer)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const load = (signal?: AbortSignal) =>
    api
      .getActiveRoster(signal)
      .then((roster) => {
        if (signal?.aborted !== true) setLoaded({ status: 'ready', roster })
      })
      .catch(() => {
        if (signal?.aborted !== true) setLoaded({ status: 'failed' })
      })

  useEffect(() => {
    if (!admin) return undefined

    const controller = new AbortController()
    void load(controller.signal)

    return () => {
      controller.abort()
    }
  }, [api, admin])

  const record = async (eventId: string, entry: RosterEntry, paid: boolean) => {
    setBusy(entry.account_id)
    setError(undefined)
    try {
      await api.setPayment(eventId, entry.account_id, {
        payment_status: paid ? 'paid' : 'unpaid',
        // Cleared when unmarking, so a date never outlives the payment it recorded.
        payment_date: paid ? new Date().toISOString().slice(0, 10) : null,
      })
      // Reloaded rather than patched in place: paying re-sorts the whole list and
      // can move someone else across the waiting line.
      await load()
    } catch (failure) {
      setError(isApiError(failure) ? failure.message : 'Could not record that. Please try again.')
    } finally {
      setBusy(undefined)
    }
  }

  if (viewer.status === 'loading') {
    return (
      <section class="page">
        <h1>Who is coming</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (!admin) {
    return (
      <section class="page">
        <h1>Who is coming</h1>
        <p>This area is for organisers. If that should be you, ask an existing organiser.</p>
      </section>
    )
  }

  const roster = loaded.status === 'ready' ? loaded.roster : undefined
  const confirmed = roster?.entries.filter((entry) => !entry.waiting).length ?? 0

  return (
    <section class="page">
      <h1>Who is coming</h1>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && (
        <p class="form-error" role="alert">
          Could not load the list. Please reload the page.
        </p>
      )}

      {error !== undefined && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      {roster !== undefined && roster.event === null && (
        <p class="form-note">There is no burn open at the moment.</p>
      )}

      {roster !== undefined && roster.event !== null && (
        <>
          <h2>{roster.event.name}</h2>
          <p class="form-note">
            {confirmed} of {roster.event.member_cap} places taken
            {roster.entries.length > confirmed ? `, ${roster.entries.length - confirmed} waiting` : ''}. Paid
            members come first, then in the order people said they were coming — so recording a payment can
            move someone else onto the waiting list.
          </p>

          <p class="row">
            <button
              type="button"
              class="link-button"
              disabled={roster.entries.length === 0}
              onClick={() => download(`${roster.event?.name ?? 'burn'}.csv`, toCsv(COLUMNS, roster.entries))}
            >
              Download as CSV
            </button>
          </p>

          {roster.entries.length === 0 ? (
            <p class="form-note">Nobody has said they are coming yet.</p>
          ) : (
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">Who</th>
                  <th scope="col">Allergies</th>
                  <th scope="col">Staying</th>
                  <th scope="col">Paid</th>
                </tr>
              </thead>
              <tbody>
                {roster.entries.map((entry) => (
                  <tr key={entry.id} class={entry.waiting ? 'waiting' : undefined}>
                    <td>
                      {entry.name ?? entry.email}
                      {entry.waiting && <span class="form-note"> · waiting</span>}
                      <br />
                      <span class="form-note">{entry.contact ?? entry.email}</span>
                    </td>
                    <td>{entry.allergies_notes ?? '—'}</td>
                    <td>
                      {entry.arrival_date ?? '?'} → {entry.departure_date ?? '?'}
                      <br />
                      <span class="form-note">{entry.lodging ?? 'no lodging said'}</span>
                    </td>
                    <td>
                      <label class="field-inline">
                        <input
                          type="checkbox"
                          checked={entry.payment_status === 'paid'}
                          disabled={busy === entry.account_id}
                          aria-label={`Paid — ${entry.name ?? entry.email}`}
                          onChange={(changeEvent) =>
                            void record(roster.event?.id ?? '', entry, changeEvent.currentTarget.checked)
                          }
                        />
                        <span>{entry.payment_date ?? ''}</span>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  )
}
