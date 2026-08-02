import type { AdminInvite, Invite } from '@sage-burner/shared'

import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { InviteLink } from '../components/InviteLink.tsx'
import { isAdmin, useViewer } from '../viewer.tsx'

export type InvitesApi = Pick<ApiClient, 'getInvites' | 'createInvite' | 'revokeInvite'>

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; invites: readonly AdminInvite[] }
  | { status: 'failed'; message: string }

const describe = (invite: AdminInvite) => {
  if (invite.applicant_name !== null) return `Application from ${invite.applicant_name}`

  return 'Direct invite'
}

export const AdminInvites = ({ api }: { api: InvitesApi }) => {
  const viewer = useViewer()
  const admin = isAdmin(viewer)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [minted, setMinted] = useState<Invite | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const load = (signal?: AbortSignal) =>
    api
      .getInvites(signal)
      .then((response) => {
        if (signal?.aborted !== true) setLoaded({ status: 'ready', invites: response.invites })
      })
      .catch((failure: unknown) => {
        if (signal?.aborted === true) return
        setLoaded({
          status: 'failed',
          message: isApiError(failure) ? failure.message : 'Could not load the invites.',
        })
      })

  useEffect(() => {
    if (!admin) return undefined

    const controller = new AbortController()
    void load(controller.signal)

    return () => {
      controller.abort()
    }
  }, [api, admin])

  const mint = async () => {
    setBusy(true)
    setError(undefined)
    // Cleared before the call, so a failure cannot leave the previous link on
    // screen beside the error and read as one invite.
    setMinted(undefined)
    try {
      const response = await api.createInvite()
      setMinted(response.invite)
      await load()
    } catch {
      setError('Could not create an invite. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: string) => {
    setBusy(true)
    setError(undefined)
    try {
      await api.revokeInvite(id)
      await load()
    } catch (failure) {
      setError(
        isApiError(failure) && failure.status === 409
          ? 'That invite cannot be revoked — it has been used, or it belongs to an approved application.'
          : 'Could not revoke that. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (viewer.status === 'loading') {
    return (
      <section class="page">
        <h1>Invites</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (viewer.status === 'signed-out') {
    return (
      <section class="page">
        <h1>Invites</h1>
        <p>
          <a href="/login">Log in</a> to see this.
        </p>
      </section>
    )
  }

  if (!admin) {
    return (
      <section class="page">
        <h1>Invites</h1>
        <p>This is an admin page. If it should be open to you, ask someone who already has admin.</p>
      </section>
    )
  }

  return (
    <section class="page">
      <h1>Invites</h1>

      <p class="form-note">
        For people you already know — returning members, partners — who should skip the application form. An
        invite is good for 30 days and can be used once.
      </p>

      <p class="row">
        <button type="button" disabled={busy} onClick={() => void mint()}>
          Create an invite
        </button>
      </p>

      {error !== undefined && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      {/* Keyed on the token so a new mint remounts: `copied` lives in the
          component, and a button still reading "Copied" after minting a second
          invite is how someone pastes the first one twice and loses the
          second for good. */}
      <InviteLink key={minted?.token} invite={minted} />

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && (
        <p class="form-error" role="alert">
          {loaded.message}
        </p>
      )}

      {loaded.status === 'ready' && loaded.invites.length === 0 && <p class="form-note">No invites yet.</p>}

      {loaded.status === 'ready' && loaded.invites.length > 0 && (
        <table class="table">
          <thead>
            <tr>
              <th scope="col">For</th>
              <th scope="col">Status</th>
              <th scope="col">Expires</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {loaded.invites.map((invite) => (
              <tr key={invite.id}>
                <td>{describe(invite)}</td>
                <td>{invite.status}</td>
                <td>{invite.expires_at.slice(0, 10)}</td>
                <td>
                  {invite.application_id === null && invite.status !== 'used' && (
                    <button
                      type="button"
                      class="link-button"
                      disabled={busy}
                      onClick={() => void revoke(invite.id)}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
