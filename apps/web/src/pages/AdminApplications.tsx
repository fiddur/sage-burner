import type { Invite } from '@sage-burner/shared'

import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { InviteLink } from '../components/InviteLink.tsx'
import { useAction, useLoad } from '../load.ts'
import { isAdmin, useViewer } from '../viewer.tsx'

export type ApplicationsApi = Pick<
  ApiClient,
  'getApplications' | 'approveApplication' | 'rejectApplication' | 'reissueInvite'
>

const answerText = (value: string | boolean) => {
  if (value === true) return 'Yes'
  if (value === false) return 'No'

  return value === '' ? '—' : value
}

export const AdminApplications = ({ api }: { api: ApplicationsApi }) => {
  const viewer = useViewer()
  const admin = isAdmin(viewer)
  const [invites, setInvites] = useState<Record<string, Invite>>({})
  // Which row, not a boolean: two applications can be decided one after the other,
  // and only the one being decided should show it.
  const [deciding, setDeciding] = useState<string | undefined>(undefined)

  const { loaded, reload } = useLoad((signal) => api.getApplications(signal), {
    enabled: admin,
    fallback: 'Could not load the applications.',
  })

  const { error, run } = useAction(reload)

  /**
   * A fresh link when the first was lost.
   *
   * Offered on every approved application rather than only where one is known to be
   * outstanding: the page cannot tell — the invite's state is not in this response —
   * and the server refuses a used one with a 409 that says so. Guessing here would
   * mean hiding the button from the person who needs it.
   */
  const reissue = (id: string) => {
    setDeciding(id)
    run(
      async () => {
        const { invite } = await api.reissueInvite(id)
        setInvites((current) => ({ ...current, [id]: invite }))
        setDeciding(undefined)
      },
      (failure: unknown) => {
        setDeciding(undefined)
        return isApiError(failure) && failure.status === 409
          ? 'That invite has already been used, so they are already in.'
          : 'Could not make a new link. Please try again.'
      },
    )
  }

  const decide = (id: string, decision: 'approve' | 'reject') => {
    setDeciding(id)
    run(
      async () => {
        const response =
          decision === 'approve' ? await api.approveApplication(id) : await api.rejectApplication(id)

        // Kept rather than re-read: the token is shown once, and the reload that
        // follows returns the application without it.
        const { invite } = response
        if (invite !== null) setInvites((current) => ({ ...current, [id]: invite }))
        setDeciding(undefined)
      },
      // A 409 means someone else decided it first, so the list on screen is stale —
      // saying "try again" would send them round the same loop.
      (failure: unknown) => {
        setDeciding(undefined)
        return isApiError(failure) && failure.status === 409
          ? 'That application was already decided. Reload to see where it stands.'
          : 'Could not save that. Please try again.'
      },
    )
  }

  return (
    <GuardedPage title="Applications" require="admin">
      <h1>Applications</h1>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      <ErrorText message={error} />

      {loaded.status === 'ready' && loaded.data.applications.length === 0 && (
        <p class="form-note">Nobody has applied yet.</p>
      )}

      {loaded.status === 'ready' &&
        loaded.data.applications.map((entry) => (
          <article key={entry.id} class="application">
            <h2>{entry.applicant_name}</h2>
            <p class="form-note">
              {entry.applicant_email} · applied {entry.submitted_at.slice(0, 10)} · {entry.status}
            </p>

            <dl>
              {entry.answers.map((answer) => (
                <div key={answer.question_id}>
                  <dt>{answer.label}</dt>
                  <dd>{answerText(answer.value)}</dd>
                </div>
              ))}
            </dl>

            {entry.status === 'pending' && (
              <p class="row">
                <button
                  type="button"
                  disabled={deciding === entry.id}
                  onClick={() => void decide(entry.id, 'approve')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  class="link-button"
                  disabled={deciding === entry.id}
                  onClick={() => void decide(entry.id, 'reject')}
                >
                  Reject
                </button>
              </p>
            )}

            {entry.status === 'approved' && (
              <p class="row">
                <button
                  type="button"
                  class="link-button"
                  disabled={deciding === entry.id}
                  onClick={() => reissue(entry.id)}
                >
                  Send a new link
                </button>
                <span class="form-note">
                  If the first one was lost. The old link stops working straight away.
                </span>
              </p>
            )}

            <InviteLink invite={invites[entry.id]} />
          </article>
        ))}
    </GuardedPage>
  )
}
