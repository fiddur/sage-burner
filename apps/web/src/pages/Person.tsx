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

export const nameOf = (row: Pick<Connection, 'kind' | 'label'>): string =>
  connectionKindInfo[row.kind].labelled && row.label.trim() !== ''
    ? row.label.trim()
    : connectionKindInfo[row.kind].label

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
          <a href={href} aria-label={`${row.value}, ${whose}’s ${label}`}>
            {row.value}
          </a>
        )}
      </span>
      {href === undefined && <CopyButton value={row.value} label={`Copy ${whose}’s ${label}`} />}
    </li>
  )
}

const namesFor = (name: string | null | undefined) => ({
  them: name ?? 'them',
  whose: name ?? 'this person',
})

const Ways = ({ rows, mine, whose }: { rows: readonly Connection[]; mine: boolean; whose: string }) => {
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
        <Way key={row.id} row={row} whose={whose} />
      ))}
    </ul>
  )
}

const Introduction = ({ written, mine, whose }: { written: string; mine: boolean; whose: string }) => {
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
        `${whose} has not written anything about themselves yet.`
      )}
    </p>
  )
}

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
            <p class="person-elsewhere">
              <a href={person.facebook}>
                <span aria-hidden="true">📘</span> {them} on Facebook
              </a>
            </p>
          )}

          <Introduction written={(person.introduction ?? '').trim()} mine={mine} whose={whose} />

          <h2>How to reach {them}</h2>

          <Ways rows={person.connections} mine={mine} whose={whose} />

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
