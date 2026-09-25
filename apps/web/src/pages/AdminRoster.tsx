import type { RosterEntry } from '@sage-burner/shared'

import { MAX_REMINDER_BODY, MAX_REMINDER_SUBJECT } from '@sage-burner/shared'
import { Fragment } from 'preact'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { allergiesOf } from '../allergies.ts'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { PersonCell } from '../components/PersonCell.tsx'
import { PlacesTaken } from '../components/PlacesTaken.tsx'
import { Table } from '../components/Table.tsx'
import { startsTheWaitingList, WaitingListLine } from '../components/WaitingListLine.tsx'
import { toCsv } from '../csv.ts'
import { useAction, useLoad } from '../load.ts'
import { rowsFor } from '../textarea.ts'
import { isAdmin, useViewer } from '../viewer.tsx'

export type RosterApi = Pick<
  ApiClient,
  'getActiveRoster' | 'setPayment' | 'getAdminAccounts' | 'adminAddAttendance' | 'remindUnpaid'
>

const COLUMNS = [
  'name',
  'email',
  'contact',
  'allergy_items',
  'allergies_notes',
  'arrival_date',
  'departure_date',
  'lodging',
  'helping',
  'helping_other',
  'notes',
  'payment_status',
  'payment_date',
  'waiting',
] as const satisfies readonly (keyof RosterEntry)[]

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

  const { loaded, reload } = useLoad((signal) => api.getActiveRoster(signal), {
    enabled: admin,
    fallback: 'Could not load the list. Please reload the page.',
  })

  const { busy, error, run } = useAction(reload)

  const record = (eventId: string, entry: RosterEntry, paid: boolean) => {
    run(
      () => api.setPayment(eventId, entry.account_id, { payment_status: paid ? 'paid' : 'unpaid' }),
      'Could not record that. Please try again.',
    )
  }

  const roster = loaded.status === 'ready' ? loaded.data : undefined

  return (
    <GuardedPage title="Who is coming" require="admin">
      <h1>Who is coming</h1>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      <ErrorText message={error} />

      {roster !== undefined && roster.event === null && (
        <p class="form-note">There is no burn open at the moment.</p>
      )}

      {roster !== undefined && roster.event !== null && (
        <>
          <h2>{roster.event.name}</h2>
          <p class="form-note">
            <PlacesTaken entries={roster.entries} cap={roster.event.member_cap} /> Paid members come first,
            then in the order people said they were coming — so recording a payment can move someone else onto
            the waiting list.
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

          <AddToBurn
            eventId={roster.event.id}
            api={api}
            already={new Set(roster.entries.map((entry) => entry.account_id))}
            onAdded={reload}
          />

          {roster.entries.length === 0 ? (
            <p class="form-note">Nobody has said they are coming yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th scope="col">Who</th>
                  <th scope="col">Allergies</th>
                  <th scope="col">Staying</th>
                  <th scope="col">Paid</th>
                </tr>
              </thead>
              <tbody>
                {roster.entries.map((entry, index) => (
                  <Fragment key={entry.id}>
                    {startsTheWaitingList(roster.entries, index) && <WaitingListLine columns={4} />}
                    <tr class={entry.waiting ? 'waiting' : undefined}>
                      <td>
                        <PersonCell
                          accountId={entry.account_id}
                          name={entry.name ?? entry.email}
                          avatar={entry.avatar}
                          waiting={entry.waiting}
                          under={entry.contact ?? entry.email}
                        />
                      </td>
                      <td>{allergiesOf(entry)}</td>
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
                            disabled={busy}
                            aria-label={`Paid — ${entry.name ?? entry.email}`}
                            onChange={(changeEvent) =>
                              void record(roster.event?.id ?? '', entry, changeEvent.currentTarget.checked)
                            }
                          />
                          <span>{entry.payment_date ?? ''}</span>
                        </label>
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </Table>
          )}

          <RemindUnpaid
            api={api}
            event={roster.event}
            unpaid={
              roster.entries.filter(
                (entry) => entry.payment_status !== 'paid' && entry.account_id !== viewer.account?.id,
              ).length
            }
          />
        </>
      )}
    </GuardedPage>
  )
}

const AddToBurn = ({
  eventId,
  api,
  already,
  onAdded,
}: {
  eventId: string
  api: RosterApi
  already: ReadonlySet<string>
  onAdded: () => void
}) => {
  const [chosen, setChosen] = useState('')

  const { loaded } = useLoad((signal) => api.getAdminAccounts(signal), {
    fallback: 'unused — the picker hides itself when the accounts will not load',
  })

  const { busy, error, run } = useAction(() => {
    setChosen('')
    onAdded()
  })

  if (loaded.status !== 'ready') return null

  const missing = loaded.data.accounts.filter((account) => !already.has(account.id))

  return (
    <div class="copy-from">
      <h3>Add somebody to this burn</h3>
      <p class="form-note">
        For somebody who joined but never said they were coming. They arrive on the burn&rsquo;s own dates,
        unpaid, and can change the rest themselves.
      </p>

      <ErrorText message={error} />

      {missing.length === 0 ? (
        <p class="form-note">Everybody with an account is already on this burn.</p>
      ) : (
        <p class="row">
          <label class="field">
            <span>Who?</span>
            <select
              aria-label="Who to add to this burn"
              disabled={busy}
              value={chosen}
              onChange={(changeEvent) => setChosen(changeEvent.currentTarget.value)}
            >
              <option value="">Choose somebody</option>
              {missing.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.email}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={busy || chosen === ''}
            onClick={() =>
              run(
                () => api.adminAddAttendance(eventId, { account_id: chosen }),
                'Could not add them to the burn.',
              )
            }
          >
            Add them
          </button>
        </p>
      )}
    </div>
  )
}

const REMINDER_BODY =
  'To secure your spot, your membership fee needs to be paid. See the members page for instructions.'

const RemindUnpaid = ({
  api,
  event,
  unpaid,
}: {
  api: RosterApi
  event: { id: string; name: string }
  unpaid: number
}) => {
  const [subject, setSubject] = useState(`Your place at ${event.name} is not paid for yet`)
  const [body, setBody] = useState(REMINDER_BODY)
  const [sent, setSent] = useState<number | undefined>(undefined)
  const { busy, error, run } = useAction()

  const send = () => {
    setSent(undefined)
    run(async () => {
      const { told } = await api.remindUnpaid(event.id, { subject, body })
      setSent(told)
    }, 'Could not send the reminder. Please try again.')
  }

  return (
    <section>
      <h3>Remind those who have not paid</h3>
      <p class="form-note">
        {unpaid === 1 ? '1 has not paid yet.' : `${unpaid} have not paid yet.`} They are told in the app, and
        by email where a mail server is set up, whatever their notification settings say.
      </p>

      <ErrorText message={error} />

      <form
        onSubmit={(submitted) => {
          submitted.preventDefault()
          send()
        }}
      >
        <label class="field">
          <span>Subject</span>
          <input
            type="text"
            maxLength={MAX_REMINDER_SUBJECT}
            value={subject}
            onInput={(typed) => setSubject(typed.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>Message</span>
          <textarea
            maxLength={MAX_REMINDER_BODY}
            rows={rowsFor(body)}
            value={body}
            onInput={(typed) => setBody(typed.currentTarget.value)}
          />
        </label>

        <PendingButton
          type="submit"
          busy={busy}
          label="Send the reminder"
          busyLabel="Sending…"
          disabled={unpaid === 0 || subject.trim() === '' || body.trim() === ''}
        />
      </form>

      {sent !== undefined && (
        <p class="form-note" role="status">
          Sent to {sent}.
        </p>
      )}
    </section>
  )
}
