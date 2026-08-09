import type { Connection, PersonProfile } from '@sage-burner/shared'

import { connectionHref, connectionKindInfo } from '@sage-burner/shared'

import type { ApiClient } from '../api/client.ts'

import { Avatar } from '../components/Avatar.tsx'
import { CopyButton } from '../components/CopyButton.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { NAMELESS } from '../components/PersonBadge.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { useLoad } from '../load.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export type PersonApi = Pick<ApiClient, 'getAccountProfile'>

/** What a way of being reached is called: the network, or the name given to a link. */
export const nameOf = (row: Pick<Connection, 'kind' | 'label'>): string =>
  connectionKindInfo[row.kind].labelled && row.label.trim() !== ''
    ? row.label.trim()
    : connectionKindInfo[row.kind].label

/**
 * One way of being reached.
 *
 * A link where the kind has an address, and something to copy where it does not — Discord
 * has no profile URL at all and a Signal number cannot build one, so an anchor there would
 * go nowhere. That is why `connectionHref` is allowed to answer nothing rather than being
 * made to produce something.
 */
const Way = ({ row, whose }: { row: Connection; whose: string }) => {
  const href = connectionHref(row.kind, row.value)
  const label = nameOf(row)

  return (
    <li class="way">
      <span aria-hidden="true">{connectionKindInfo[row.kind].icon}</span>
      <span class="way-what">
        <span class="way-name">{label}</span>{' '}
        {href === undefined ? (
          <span class="form-note">{row.value}</span>
        ) : (
          // Named for a screen reader, which would otherwise read a page of "wren" links
          // with nothing to tell them apart — and the visible text comes first, because a
          // name that does not contain it cannot be addressed by voice (WCAG 2.5.3).
          <a href={href} aria-label={`${row.value}, ${whose}’s ${label}`}>
            {row.value}
          </a>
        )}
      </span>
      {href === undefined && <CopyButton value={row.value} label={`Copy ${whose}’s ${label}`} />}
    </li>
  )
}

/**
 * How the page refers to somebody, in the two grammars it needs.
 *
 * `them` goes in prose — "how to reach them" — and cannot take a possessive: with no name
 * filled in, the copy button read "Copy them’s Discord".
 */
const namesFor = (name: string | null | undefined) => ({
  them: name ?? 'them',
  whose: name ?? 'this person',
})

/**
 * Somebody's page (#389).
 *
 * The answer to the question anybody actually has about a name they have not met: how do I
 * get hold of this person. Their ways of being reached in **their** order, so the first is
 * where they would rather be tried — which is the whole reason the list is orderable.
 *
 * Your own page is this same page with a link to where you change it, rather than a second
 * layout to keep in step with this one.
 */
export const Person = ({ api, accountId }: { api: PersonApi; accountId: string }) => {
  const viewer = useViewer()
  const { loaded, refreshing } = useLoad<PersonProfile>(
    async (signal) => (await api.getAccountProfile(accountId, signal)).person,
    {
      enabled: isApproved(viewer),
      key: accountId,
      fallback: 'Could not load that page. The account may be gone.',
      remember: 'person',
    },
  )

  const mine = viewer.account?.id === accountId
  const person = loaded.status === 'ready' ? loaded.data : undefined
  const { them, whose } = namesFor(person?.name)

  return (
    <GuardedPage title="Somebody" require="approved">
      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}
      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {person !== undefined && (
        <>
          <h1 class="person-head">
            <Avatar
              accountId={person.account_id}
              name={person.name}
              avatar={person.avatar}
              size="person-face"
            />
            <span>{person.name ?? NAMELESS}</span> <Refreshing on={refreshing} />
          </h1>

          {mine && (
            <p class="form-note">
              This is your own page, as everybody else sees it. <a href="/profile">Your details</a> is where
              you change it.
            </p>
          )}

          {person.facebook !== null && (
            // Beside the name rather than in the list below, because it is not a way of
            // being reached: Messenger is that, and it is a row like any other. Built from
            // the Messenger handle, never from a linked sign-in (#393).
            <p class="person-elsewhere">
              <a href={person.facebook}>
                <span aria-hidden="true">📘</span> {them} on Facebook
              </a>
            </p>
          )}

          <h2>How to reach {them}</h2>

          {person.connections.length > 0 ? (
            <ul class="ways">
              {person.connections.map((row) => (
                <Way key={row.id} row={row} whose={whose} />
              ))}
            </ul>
          ) : (
            <p class="form-note">
              {mine
                ? 'You have not said how people can reach you yet.'
                : 'Nothing said yet about how to reach them.'}
            </p>
          )}

          {/* The free-text box from before the list existed, last of all —
              `personProfileSchema` says why it is still here. */}
          {person.contact !== null && person.contact.trim() !== '' && (
            <p class="form-note">Also said: {person.contact}</p>
          )}
        </>
      )}
    </GuardedPage>
  )
}
