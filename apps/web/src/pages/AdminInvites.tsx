import type { AdminInvite, Invite, InviteRedemption } from '@sage-burner/shared'

import { MAX_GROUP_INVITE_USES, MAX_INVITE_LABEL } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { Destroy } from '../components/Destroy.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { InviteLink } from '../components/InviteLink.tsx'
import { Table } from '../components/Table.tsx'
import { fromLocalInput, todayForInput } from '../datetime.ts'
import { errorMessage, useAction, useLoad } from '../load.ts'
import { isAdmin, useViewer } from '../viewer.tsx'

export type InvitesApi = Pick<ApiClient, 'getInvites' | 'createInvite' | 'createGroupInvite' | 'revokeInvite'>

const describe = (invite: AdminInvite) => {
  if (invite.kind === 'group') return invite.label ?? 'Group link'
  if (invite.applicant_name !== null) return `Application from ${invite.applicant_name}`

  return 'Direct invite'
}

const usage = (invite: AdminInvite) => {
  if (invite.kind !== 'group') return null

  const taken = invite.redemptions.length

  return invite.max_uses === null ? `${taken} so far` : `${taken} of ${invite.max_uses}`
}

const nameOf = (who: InviteRedemption) => who.name ?? 'Someone'

const GroupLinkForm = ({
  busy,
  onMint,
}: {
  busy: boolean
  onMint: (expires_at: string, label: string, max_uses: number | null) => void
}) => {
  const [label, setLabel] = useState('')
  const [closes, setCloses] = useState('')
  const [cap, setCap] = useState('')
  const today = todayForInput()

  const ready = label.trim() !== '' && closes !== ''
  const alreadyShut = closes !== '' && closes < today

  return (
    <form
      class="form"
      onSubmit={(submitted) => {
        submitted.preventDefault()
        if (!ready || alreadyShut) return

        const at = fromLocalInput(`${closes}T23:59`)
        if (at === null) return

        onMint(at, label.trim(), cap === '' ? null : Number(cap))
      }}
    >
      <fieldset class="field">
        <legend>A link for a closed group</legend>

        <p class="form-note">
          Posted inside a group only its members can read — a Facebook group, a Discord server — the link is
          the proof of belonging. Anyone holding it can make an account until it closes.
        </p>

        <label class="field">
          <span>Which group</span>
          <input
            type="text"
            maxLength={MAX_INVITE_LABEL}
            placeholder="The Facebook group"
            value={label}
            onInput={(typed) => setLabel(typed.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>Closes on</span>
          <input
            type="date"
            min={today}
            aria-invalid={alreadyShut}
            value={closes}
            onInput={(typed) => setCloses(typed.currentTarget.value)}
          />
        </label>
        {alreadyShut && <ErrorText message="That date has gone. A link has to close in the future." />}

        <label class="field">
          <span>At most this many (optional)</span>
          <input
            type="number"
            min={1}
            max={MAX_GROUP_INVITE_USES}
            value={cap}
            onInput={(typed) => setCap(typed.currentTarget.value)}
          />
        </label>

        <p class="row">
          <button type="submit" disabled={busy || !ready || alreadyShut}>
            Create a group link
          </button>
        </p>
      </fieldset>
    </form>
  )
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
    setMinted(undefined)
    run(async () => {
      const response = await api.createInvite()
      setMinted(response.invite)
    }, 'Could not create an invite. Please try again.')
  }

  const mintGroup = (expires_at: string, label: string, max_uses: number | null) => {
    setMinted(undefined)
    run(
      async () => {
        const response = await api.createGroupInvite({ expires_at, label, max_uses })
        setMinted(response.invite)
      },
      (failure) =>
        isApiError(failure) && failure.code === 'expired'
          ? 'That closing date has gone. Pick one in the future — a link has to close some time.'
          : errorMessage(failure, 'Could not create that link. Please try again.'),
    )
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

      <GroupLinkForm busy={busy} onMint={mintGroup} />

      <ErrorText message={error} />

      {/* Keyed on the token so a new mint remounts and "Copied" does not carry over. */}
      <InviteLink key={minted?.token} invite={minted} />

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && loaded.data.invites.length === 0 && (
        <p class="form-note">No invites yet.</p>
      )}

      {loaded.status === 'ready' && loaded.data.invites.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th scope="col">For</th>
              <th scope="col">Status</th>
              <th scope="col">Used</th>
              <th scope="col">Expires</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {loaded.data.invites.map((invite) => (
              <tr key={invite.id}>
                <td>
                  {describe(invite)}
                  {invite.redemptions.length > 0 && (
                    <span class="form-note"> — {invite.redemptions.map(nameOf).join(', ')}</span>
                  )}
                </td>
                <td>{invite.status}</td>
                <td>{usage(invite)}</td>
                <td>{invite.expires_at.slice(0, 10)}</td>
                <td>
                  {invite.application_id === null &&
                    invite.status !== 'used' &&
                    invite.status !== 'revoked' && (
                      <Destroy
                        what={describe(invite)}
                        verb="Revoke"
                        because="The link stops working; whoever came in on it stays."
                        trigger="Revoke"
                        busy={busy}
                        onDestroy={() => void revoke(invite.id)}
                      />
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </GuardedPage>
  )
}
