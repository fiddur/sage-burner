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
import { renderMarkdown } from '../markdown.ts'
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
          // with nothing to tell them apart.
          <a href={href} aria-label={`${label}: ${whose}`}>
            {row.value}
          </a>
        )}
      </span>
      {href === undefined && <CopyButton value={row.value} label={`Copy ${whose}’s ${label}`} />}
    </li>
  )
}

/**
 * The list itself, in the order they put it in, or the fact that there is none.
 *
 * The order is the whole point: the first is where they would rather be tried, which is why
 * the list is one somebody drags around rather than a set.
 */
const Ways = ({ rows, mine, them }: { rows: readonly Connection[]; mine: boolean; them: string }) => {
  if (rows.length === 0) {
    return (
      <p class="form-note">
        {mine
          ? 'You have not said how people can reach you yet.'
          : 'Nothing said yet about how to reach them.'}
      </p>
    )
  }

  return (
    <ul class="ways">
      {rows.map((row) => (
        <Way key={row.id} row={row} whose={them} />
      ))}
    </ul>
  )
}

/**
 * What somebody wrote about themselves, or the fact that they have not (#390).
 *
 * Above the ways of reaching them, because it answers the question somebody opening this
 * page has first: who is this. Safe by construction — `renderMarkdown` escapes raw HTML
 * rather than filtering it, which is what makes every member here inside what it defends
 * against.
 *
 * The empty state is worth more than the field on somebody's own page: this only works if
 * people fill it in, and the moment they are most likely to is the one where the app says
 * plainly that nothing is there.
 */
const Introduction = ({ written, mine, them }: { written: string; mine: boolean; them: string }) => {
  if (written !== '') {
    return (
      <div
        class="markdown-preview person-introduction"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(written) }}
      />
    )
  }

  return (
    <p class="form-note">
      {mine ? (
        <>
          {/* Not a second "Your details" link: the note above already carries one, and two
              anchors with the same accessible name on one page is what a screen reader
              reads as one place twice. */}
          You have not written anything about yourself yet —{' '}
          <a href="/profile">write a paragraph and add a picture or two</a>. It is what makes your name mean
          something to somebody who has not met you.
        </>
      ) : (
        `${them} has not written anything about themselves yet.`
      )}
    </p>
  )
}

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
  const them = person?.name ?? 'them'

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
            // being reached: Messenger is that, and it is a row like any other. This is
            // their page, which the app knows about only because they linked Facebook to
            // sign in (#393).
            <p class="person-elsewhere">
              <a href={person.facebook}>
                <span aria-hidden="true">📘</span> {them} on Facebook
              </a>
            </p>
          )}

          <Introduction written={(person.introduction ?? '').trim()} mine={mine} them={them} />

          <h2>How to reach {them}</h2>

          <Ways rows={person.connections} mine={mine} them={them} />

          {/* The free-text box from before the list existed, last of all: still required,
              still filled in for every account, and still where a sentence that fits no
              kind goes. */}
          {person.contact !== null && person.contact.trim() !== '' && (
            <p class="form-note">Also said: {person.contact}</p>
          )}
        </>
      )}
    </GuardedPage>
  )
}
