import type { Application, Invite } from '@sage-burner/shared'

import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { isAdmin, useViewer } from '../viewer.tsx'

export type ApplicationsApi = Pick<ApiClient, 'getApplications' | 'approveApplication' | 'rejectApplication'>

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; applications: readonly Application[] }
  | { status: 'failed'; message: string }

const answerText = (value: string | boolean) => {
  if (value === true) return 'Yes'
  if (value === false) return 'No'

  return value === '' ? '—' : value
}

/**
 * The invite link, shown once.
 *
 * Built here rather than server-side so the API needs no notion of its own
 * public URL — the page is served from the same origin the link has to point at.
 */
const inviteUrl = (invite: Invite) => `${window.location.origin}/invite/${invite.token}`

const InviteLink = ({
  invite,
  copied,
  onCopy,
}: {
  invite: Invite | undefined
  copied: boolean
  onCopy: () => void
}) => {
  if (invite === undefined) return null

  const url = inviteUrl(invite)

  return (
    <p class="form-note" role="status">
      Send them this link — it is shown once and cannot be recovered afterwards. Expires{' '}
      {invite.expires_at.slice(0, 10)}.
      <br />
      <code>{url}</code>
      <br />
      <button
        type="button"
        class="link-button"
        onClick={() => {
          // Only on success. `writeText` rejects on a denied permission or an
          // unfocused document, and `navigator.clipboard` is undefined entirely
          // on a non-secure origin. For a token shown once, with no way to
          // re-issue it (#91), a false "Copied" is how an organiser loses an
          // applicant's invite; the URL above stays selectable by hand.
          navigator.clipboard?.writeText(url).then(onCopy, () => undefined)
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </p>
  )
}

export const AdminApplications = ({ api }: { api: ApplicationsApi }) => {
  const viewer = useViewer()
  const admin = isAdmin(viewer)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [invites, setInvites] = useState<Record<string, Invite>>({})
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [copied, setCopied] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!admin) return undefined

    const controller = new AbortController()

    api
      .getApplications(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          setLoaded({ status: 'ready', applications: response.applications })
        }
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return
        setLoaded({
          status: 'failed',
          message: isApiError(failure) ? failure.message : 'Could not load the applications.',
        })
      })

    return () => {
      controller.abort()
    }
  }, [api, admin])

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(id)
    setError(undefined)
    try {
      const response =
        decision === 'approve' ? await api.approveApplication(id) : await api.rejectApplication(id)

      setLoaded((current) =>
        current.status === 'ready'
          ? {
              status: 'ready',
              applications: current.applications.map((entry) =>
                entry.id === id ? response.application : entry,
              ),
            }
          : current,
      )
      const { invite } = response
      if (invite !== null) setInvites((current) => ({ ...current, [id]: invite }))
    } catch (failure) {
      // A 409 means someone else decided it first, so the list on screen is
      // stale — saying "try again" would send them round the same loop.
      setError(
        isApiError(failure) && failure.status === 409
          ? 'That application was already decided. Reload to see where it stands.'
          : 'Could not save that. Please try again.',
      )
    } finally {
      setBusy(undefined)
    }
  }

  if (viewer.status === 'loading') {
    return (
      <section class="page">
        <h1>Applications</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (viewer.status === 'signed-out') {
    return (
      <section class="page">
        <h1>Applications</h1>
        <p>
          <a href="/login">Log in</a> to see this.
        </p>
      </section>
    )
  }

  if (!admin) {
    return (
      <section class="page">
        <h1>Applications</h1>
        <p>This area is for organisers. If that should be you, ask an existing organiser.</p>
      </section>
    )
  }

  return (
    <section class="page">
      <h1>Applications</h1>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && (
        <p class="form-error" role="alert">
          {loaded.message}
        </p>
      )}

      {error !== undefined && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      {loaded.status === 'ready' && loaded.applications.length === 0 && (
        <p class="form-note">Nobody has applied yet.</p>
      )}

      {loaded.status === 'ready' &&
        loaded.applications.map((entry) => (
          <article key={entry.id} class="application">
            <h2>{entry.applicant_name}</h2>
            <p class="form-note">
              {entry.applicant_contact} · applied {entry.submitted_at.slice(0, 10)} · {entry.status}
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
                  disabled={busy === entry.id}
                  onClick={() => void decide(entry.id, 'approve')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  class="link-button"
                  disabled={busy === entry.id}
                  onClick={() => void decide(entry.id, 'reject')}
                >
                  Reject
                </button>
              </p>
            )}

            <InviteLink
              invite={invites[entry.id]}
              copied={copied === entry.id}
              onCopy={() => setCopied(entry.id)}
            />
          </article>
        ))}
    </section>
  )
}
