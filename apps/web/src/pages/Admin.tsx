import type { AccountRole, AdminAccount } from '@sage-burner/shared'

import { accountRoles } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { isAdmin, useViewer } from '../viewer.tsx'

export type AdminApi = Pick<ApiClient, 'getAdminAccounts' | 'setAccountRoles'>

type Roster =
  | { status: 'loading' }
  | { status: 'ready'; accounts: readonly AdminAccount[] }
  | { status: 'failed'; message: string }

const withRole = (roles: readonly AccountRole[], role: AccountRole, held: boolean): AccountRole[] =>
  held ? [...new Set([...roles, role])] : roles.filter((entry) => entry !== role)

/**
 * The organiser's landing page.
 *
 * The role check below decides what to *render*. It is not the access control:
 * `/api/admin/accounts` refuses a non-admin with a 403 whatever this does.
 */
export const Admin = ({ api }: { api: AdminApi }) => {
  const viewer = useViewer()
  const admin = isAdmin(viewer)
  const [roster, setRoster] = useState<Roster>({ status: 'loading' })
  const [saving, setSaving] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

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

  const toggle = async (entry: AdminAccount, role: AccountRole, held: boolean) => {
    setError(undefined)
    setSaving(entry.id)
    try {
      const { account } = await api.setAccountRoles(entry.id, { roles: withRole(entry.roles, role, held) })
      setRoster((current) =>
        current.status === 'ready'
          ? {
              status: 'ready',
              accounts: current.accounts.map((row) => (row.id === account.id ? account : row)),
            }
          : current,
      )
    } catch (failure) {
      setError(
        isApiError(failure) && failure.status === 409
          ? 'Someone has to keep admin. Give it to another account first.'
          : isApiError(failure)
            ? failure.message
            : 'Could not change that. Please try again.',
      )
    } finally {
      setSaving(undefined)
    }
  }

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
        <p>This is an admin page. If it should be open to you, ask someone who already has admin.</p>
      </section>
    )
  }

  return (
    <section class="page">
      <h1>Organise</h1>

      <p>
        <a href="/admin/events">Events</a>
      </p>
      <p>
        <a href="/admin/questions">Application questions</a>
      </p>
      <p>
        <a href="/admin/applications">Applications</a>
      </p>
      <p>
        <a href="/admin/invites">Invites</a>
      </p>
      <p>
        <a href="/admin/roster">Who is coming</a>
      </p>
      <p>
        <a href="/admin/places">Places</a>
      </p>
      <p>
        <a href="/admin/options">Lodging and helping</a>
      </p>
      <p>
        <a href="/admin/settings">Settings</a>
      </p>

      <h2>Accounts</h2>

      {roster.status === 'loading' && <p class="form-note">Loading…</p>}

      {roster.status === 'failed' && (
        <p class="form-error" role="alert">
          {roster.message}
        </p>
      )}

      {error !== undefined && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      {roster.status === 'ready' && (
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Email</th>
              {accountRoles.map((role) => (
                <th key={role} scope="col">
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roster.accounts.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.email}</td>
                {accountRoles.map((role) => (
                  <td key={role}>
                    <input
                      type="checkbox"
                      checked={entry.roles.includes(role)}
                      disabled={saving !== undefined}
                      aria-label={`${role} — ${entry.email}`}
                      onChange={(changeEvent) => {
                        void toggle(entry, role, changeEvent.currentTarget.checked)
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p class="form-note">
        An account with neither is normal — an applicant, or someone invited who has not finished. Member
        opens someone&rsquo;s own details and saying they are coming; admin opens this page. Most people here
        want both.
      </p>
    </section>
  )
}
