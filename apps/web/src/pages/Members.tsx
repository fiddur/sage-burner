import type { MemberRosterEntry, MemberRosterResponse } from '@sage-burner/shared'

import { profilePage } from '@sage-burner/shared'
import { Fragment } from 'preact'

import type { ApiClient } from '../api/client.ts'

import { allergiesOf } from '../allergies.ts'
import { useSelectedBurn } from '../burn.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { NoBurn } from '../components/NoBurn.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { Table } from '../components/Table.tsx'
import { WaitingListLine, startsTheWaitingList } from '../components/WaitingListLine.tsx'
import { useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export type MembersApi = Pick<ApiClient, 'getMembers'>

/**
 * Who else is coming, for the people coming with them.
 *
 * The read half of "a member may write their own record, and the burn's shared
 * furniture" (#159). Whoever is cooking needs the allergies, and those live on the
 * account precisely so somebody can read them — which was not true while the only
 * route serving them sat under `/api/admin/`.
 *
 * Read-only, all of it. Somebody else's stay is theirs to edit, and *recording* a
 * payment stays admin's — but whether somebody has paid is shown to everyone, being
 * the definite mark of actually joining.
 */
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
  const confirmed = roster?.entries.filter((entry) => !entry.waiting).length ?? 0

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
          <p class="form-note">
            {confirmed} of {roster.event.member_cap} places taken
            {roster.entries.length > confirmed ? `, ${roster.entries.length - confirmed} waiting` : ''}.
          </p>

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

/**
 * How to pay — or, once the burn is paid full, how a place changes hands.
 *
 * Only to whoever has not paid: everybody else has done it, and a standing
 * instruction to pay is noise on a page they read for the allergies. It is the one
 * thing here addressed to the reader rather than about the burn.
 *
 * The count is of **paid** members, not of `waiting`. `withPlaces` sets `waiting` by
 * position alone, so a full list is not a paid-full burn — and while places remain
 * unpaid, paying still secures one, which makes the payment instructions exactly
 * what the people above the line need.
 */
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
      {/* Safe by construction: `renderMarkdown` escapes raw HTML rather than filtering it. */}
      <div class="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(info) }} />
    </div>
  )
}

/**
 * Who is coming, in the order that decides who has a place.
 *
 * Its own component so the page above stays a page — the branching for loading,
 * failure, no burn and no entries is what `Members` is about, and the table's rows
 * were pushing that over the complexity ceiling.
 */
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
              {/* No fallback to the email address the way the admin's
                      list has, because the response does not carry one. */}
              <a href={profilePage(entry.account_id)}>{entry.name ?? 'Name not filled in yet'}</a>
              {entry.waiting && <span class="form-note"> · waiting</span>}
              <br />
              <span class="form-note">{entry.contact ?? 'no contact given'}</span>
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
            {/* A word, not a tick: a checkbox reads as something to click,
                    and this is the one column here nobody may change. */}
            <td>{entry.payment_status === 'paid' ? 'yes' : 'not yet'}</td>
          </tr>
        </Fragment>
      ))}
    </tbody>
  </Table>
)
