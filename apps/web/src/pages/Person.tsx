import type { Connection, PersonProfile, Thread } from '@sage-burner/shared'

import { connectionHref, connectionKindInfo } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { Avatar } from '../components/Avatar.tsx'
import { CopyButton } from '../components/CopyButton.tsx'
import { DreamThread } from '../components/DreamThread.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { NAMELESS } from '../components/PersonBadge.tsx'
import { Refreshing } from '../components/Refreshing.tsx'
import { useAction, useLoad } from '../load.ts'
import { renderMarkdown } from '../markdown.ts'
import { isAdmin, isApproved, useViewer } from '../viewer.tsx'

export type PersonApi = Pick<
  ApiClient,
  | 'getAccountProfile'
  | 'getThread'
  | 'postComment'
  | 'updateComment'
  | 'deleteComment'
  | 'supportComment'
  | 'withdrawSupportForComment'
  | 'uploadImage'
  | 'getApprovedAccounts'
>

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
          {/* Not a second "Your details" link: two anchors with one name read as one place twice. */}
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

const Talks = ({ api, cardIds }: { api: PersonApi; cardIds: readonly string[] }) => {
  const viewer = useViewer()

  const { loaded: said } = useLoad<Thread[]>(
    async (signal) => await Promise.all(cardIds.map(async (id) => (await api.getThread(id, signal)).thread)),
    {
      enabled: cardIds.length > 0,
      key: cardIds.join(','),
      fallback: 'Could not load what people have said.',
    },
  )

  const { loaded: everybody } = useLoad(async (signal) => (await api.getApprovedAccounts(signal)).accounts, {
    enabled: isApproved(viewer),
    fallback: 'Could not load who can be mentioned.',
  })
  const people = everybody.status === 'ready' ? everybody.data : []

  const [fresher, setFresher] = useState<Record<string, Thread>>({})
  const { busy, error, run } = useAction()
  const hold = (thread: Thread) => setFresher((sofar) => ({ ...sofar, [thread.id]: thread }))

  const talk = {
    say: (threadId: string, body: string, done: () => void) =>
      run(async () => {
        hold((await api.postComment(threadId, { body })).thread)
        done()
      }, 'Could not say that.'),
    rewrite: (id: string, body: string, done: () => void) =>
      run(async () => {
        hold((await api.updateComment(id, { body })).thread)
        done()
      }, 'Could not save that.'),
    remove: (id: string) =>
      run(async () => hold((await api.deleteComment(id)).thread), 'Could not take that back.'),
    heart: (id: string, hearting: boolean) =>
      run(
        async () =>
          hold((hearting ? await api.supportComment(id) : await api.withdrawSupportForComment(id)).thread),
        'Could not do that just now.',
      ),
  }

  const cards = said.status === 'ready' ? said.data : []

  if (cardIds.length === 0) return null

  return (
    <>
      <h2>What people say</h2>
      {said.status === 'loading' && <p class="form-note">Loading…</p>}
      {said.status === 'failed' && <ErrorText message={said.message} />}
      <ErrorText message={error} />
      {cards.map((card) => {
        const shown = fresher[card.id] ?? card
        return (
          <section key={shown.id} class="person-talk">
            {shown.burn !== null && <h3 class="person-talk-burn">{shown.burn}</h3>}
            <DreamThread
              thread={shown}
              viewerId={viewer.account?.id}
              admin={isAdmin(viewer)}
              busy={busy}
              more={false}
              upload={api.uploadImage}
              people={people}
              onSay={(body, done) => talk.say(shown.id, body, done)}
              onRewrite={talk.rewrite}
              onRemove={talk.remove}
              onHeart={talk.heart}
            />
          </section>
        )
      })}
    </>
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
    <GuardedPage title="Somebody" require="approved" width="column">
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

          {person.contact !== null && person.contact.trim() !== '' && (
            <p class="form-note">Also said: {person.contact}</p>
          )}

          <Talks api={api} cardIds={person.card_thread_ids} />
        </>
      )}
    </GuardedPage>
  )
}
