import type { MemberRosterEntry, MemberRosterResponse } from '@sage-burner/shared'

import { placesIn } from '@sage-burner/shared'
import { Fragment } from 'preact'

import type { ApiClient } from '../api/client.ts'

import { allergiesOf } from '../allergies.ts'
import { useSelectedBurn } from '../burn.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { PersonCell } from '../components/PersonCell.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { Table } from '../components/Table.tsx'
import { startsTheWaitingList, WaitingListLine } from '../components/WaitingListLine.tsx'
import { useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export type MembersApi = Pick<ApiClient, 'getMembers'>

const PlacesTaken = ({ entries, cap }: { entries: readonly MemberRosterEntry[]; cap: number }) => {
  const places = placesIn(entries, cap)

  return (
    <p class="form-note">
      {places.taken} of {cap} places taken
      {places.waiting > 0 ? `, ${places.waiting} waiting` : ''}.
    </p>
  )
}

export const Members = ({ api }: { api: MembersApi }) => {
  const viewer = useViewer()
  const burn = useSelectedBurn()
  const { loaded, refreshing } = useLoad(
    async (signal) =>
      burn === undefined ? { event: null, entries: [] } : await api.getMembers(burn.event.id, signal),
    {
      enabled: isApproved(viewer),
      key: burn?.event.id ?? '',
      fallback: 'Could not load the list. Please reload the page.',
      live: true,
      remember: 'members',
    },
  )

  const roster = loaded.status === 'ready' ? loaded.data : undefined

  return (
    <GuardedPage title="Members" require="approved">
      <h1>
        Members <Refreshing on={refreshing} />
      </h1>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {roster !== undefined && roster.event === null && <NoBurn absent="there is nobody to list" />}

      {roster !== undefined && roster.event !== null && (
        <>
          <h2>{roster.event.name}</h2>
          <PlacesTaken entries={roster.entries} cap={roster.event.member_cap} />

          <HowToPay event={roster.event} entries={roster.entries} me={viewer.account?.id} />

          {roster.entries.length === 0 ? (
            <p class="form-note">Nobody has said they are coming yet.</p>
          ) : (
            <RosterTable entries={roster.entries} />
          )}
        </>
      )}
    </GuardedPage>
  )
}

const HowToPay = ({
  event,
  entries,
  me,
}: {
  event: NonNullable<MemberRosterResponse['event']>
  entries: readonly MemberRosterEntry[]
  me: string | undefined
}) => {
  const paidUp = entries.filter((entry) => entry.payment_status === 'paid').length
  const info = paidUp >= event.member_cap ? event.transfer_info_markdown : event.payment_info_markdown
  const owed = entries.some((entry) => entry.account_id === me && entry.payment_status !== 'paid')

  if (!owed || info.trim() === '') return null

  return (
    <div class="notice">
      <div class="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(info) }} />
    </div>
  )
}

const RosterTable = ({ entries }: { entries: readonly MemberRosterEntry[] }) => (
  <Table>
    <thead>
      <tr>
        <th scope="col">Who</th>
        <th scope="col">Allergies</th>
        <th scope="col">Staying</th>
        <th scope="col">Helping with</th>
        <th scope="col">Paid</th>
      </tr>
    </thead>
    <tbody>
      {entries.map((entry, index) => (
        <Fragment key={entry.id}>
          {startsTheWaitingList(entries, index) && <WaitingListLine columns={5} />}
          <tr class={entry.waiting ? 'waiting' : undefined}>
            <td>
              {/* No fallback to an email address, unlike the admin list: this response carries none. */}
              <PersonCell
                accountId={entry.account_id}
                name={entry.name ?? 'Name not filled in yet'}
                avatar={entry.avatar}
                waiting={entry.waiting}
                under={entry.contact ?? 'no contact given'}
              />
            </td>
            <td>{allergiesOf(entry)}</td>
            <td>
              {entry.arrival_date ?? '?'} → {entry.departure_date ?? '?'}
              <br />
              <span class="form-note">{entry.lodging ?? 'no lodging said'}</span>
            </td>
            <td>
              {entry.helping ?? '—'}
              {entry.helping_other !== null && (
                <>
                  <br />
                  <span class="form-note">{entry.helping_other}</span>
                </>
              )}
            </td>
            <td>{entry.payment_status === 'paid' ? 'yes' : 'not yet'}</td>
          </tr>
        </Fragment>
      ))}
    </tbody>
  </Table>
)
