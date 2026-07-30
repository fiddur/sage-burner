import type { AdminAccount } from '@sage-burner/shared'

import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { isAdmin, useViewer } from '../viewer.tsx'

type Roster =
  | { status: 'loading' }
  | { status: 'ready'; accounts: readonly AdminAccount[] }
  | { status: 'failed'; message: string }

/**
 * The organiser's landing page.
 *
 * Only the roster for now — approving applications, invites and scheduling get
 * their own pages. It exists this early because it is the first thing that
 * answers "did the bootstrap work, and who else is here?".
 *
 * The role check below decides what to *render*. It is not the access control:
 * `/api/admin/accounts` refuses a non-admin with a 403 whatever this does.
 */
export const Admin = ({ api }: { api: Pick<ApiClient, 'getAdminAccounts'> }) => {
  const viewer = useViewer()
  const admin = isAdmin(viewer)
  const [roster, setRoster] = useState<Roster>({ status: 'loading' })

  useEffect(() => {
    if (!admin) return undefined

    const controller = new AbortController()

    api
      .getAdminAccounts(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setRoster({ status: 'ready', accounts: response.accounts })
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return
        setRoster({
          status: 'failed',
          message: isApiError(failure) ? failure.message : 'Could not load the roster.',
        })
      })

    return () => {
      controller.abort()
    }
    // `admin` rather than `viewer`: the provider hands out a new object on every
    // render, so depending on the viewer itself would refetch continuously.
  }, [api, admin])

  if (viewer.status === 'loading') {
    return (
      <section class="page">
        <h1>Organise</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (viewer.status === 'signed-out') {
    // Distinct from the signed-in-without-the-role case below: telling someone
    // to "ask an organiser" when they simply have not signed in yet sends them
    // to a person instead of to the form that would fix it.
    return (
      <section class="page">
        <h1>Organise</h1>
        <p>
          <a href="/login">Log in</a> to see this.
        </p>
      </section>
    )
  }

  if (!admin) {
    return (
      <section class="page">
        <h1>Organise</h1>
        <p>This area is for organisers. If that should be you, ask an existing organiser.</p>
      </section>
    )
  }

  return (
    <section class="page">
      <h1>Organise</h1>

      <h2>Accounts</h2>

      {roster.status === 'loading' && <p class="form-note">Loading…</p>}

      {roster.status === 'failed' && (
        <p class="form-error" role="alert">
          {roster.message}
        </p>
      )}

      {roster.status === 'ready' && (
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Roles</th>
            </tr>
          </thead>
          <tbody>
            {roster.accounts.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.email}</td>
                {/* An account with no roles is normal — an applicant, or someone
                    invited but not yet made a member — so it says so rather
                    than rendering an empty cell that reads as a bug. */}
                <td>{entry.roles.length === 0 ? 'none yet' : entry.roles.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
