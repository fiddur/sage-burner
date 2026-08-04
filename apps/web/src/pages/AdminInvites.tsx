import type { AdminInvite, Invite } from '@sage-burner/shared'

import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { InviteLink } from '../components/InviteLink.tsx'
import { useAction, useLoad } from '../load.ts'
import { isAdmin, useViewer } from '../viewer.tsx'

export type InvitesApi = Pick<ApiClient, 'getInvites' | 'createInvite' | 'revokeInvite'>

const describe = (invite: AdminInvite) => {
  if (invite.applicant_name !== null) return `Application from ${invite.applicant_name}`

  return 'Direct invite'
}

export const AdminInvites = ({ api }: { api: InvitesApi }) => {
  const viewer = useViewer()
  const admin = isAdmin(viewer)
  const [minted, setMinted] = useState<Invite | undefined>(undefined)

  const { loaded, reload } = useLoad((signal) => api.getInvites(signal), {
    enabled: admin,
    fallback: 'Could not load the invites.',
  })

  const { busy, error, run } = useAction(reload)

  const mint = () => {
    // Cleared before the call, so a failure cannot leave the previous link on
    // screen beside the error and read as one invite.
    setMinted(undefined)
    run(async () => {
      const response = await api.createInvite()
      setMinted(response.invite)
    }, 'Could not create an invite. Please try again.')
  }

  const revoke = (id: string) => {
    run(
      () => api.revokeInvite(id),
      (failure: unknown) =>
        isApiError(failure) && failure.status === 409
          ? 'That invite cannot be revoked — it has been used, or it belongs to an approved application.'
          : 'Could not revoke that. Please try again.',
    )
  }

  return (
    <GuardedPage title="Invites" require="admin">
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

      {loaded.status === 'ready' && loaded.data.invites.length === 0 && (
        <p class="form-note">No invites yet.</p>
      )}

      {loaded.status === 'ready' && loaded.data.invites.length > 0 && (
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
            {loaded.data.invites.map((invite) => (
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
    </GuardedPage>
  )
}
