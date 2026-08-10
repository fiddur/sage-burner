import type { AccountRole, AdminAccount } from '@sage-burner/shared'

import { accountRoles } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { ErrorText } from '../components/ErrorText.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { Table } from '../components/Table.tsx'
import { errorMessage, useAction, useLoad } from '../load.ts'
import { isAdmin, useViewer } from '../viewer.tsx'

export type AdminApi = Pick<ApiClient, 'getAdminAccounts' | 'setAccountRoles' | 'setAccountPassword'>

const withRole = (roles: readonly AccountRole[], role: AccountRole, held: boolean): AccountRole[] =>
  held ? [...new Set([...roles, role])] : roles.filter((entry) => entry !== role)

export const Admin = ({ api }: { api: AdminApi }) => {
  const viewer = useViewer()
  const admin = isAdmin(viewer)

  const { loaded: roster, reload } = useLoad((signal) => api.getAdminAccounts(signal), {
    enabled: admin,
    fallback: 'Could not load the roster.',
  })

  const { busy, error, run } = useAction(reload)

  const toggle = (entry: AdminAccount, role: AccountRole, held: boolean) => {
    run(
      () => api.setAccountRoles(entry.id, { roles: withRole(entry.roles, role, held) }),
      (failure: unknown) =>
        isApiError(failure) && failure.status === 409
          ? 'Someone has to keep admin. Give it to another account first.'
          : errorMessage(failure, 'Could not change that. Please try again.'),
    )
  }

  return (
    <GuardedPage title="Organise" require="admin">
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
        <a href="/places">Places</a>
      </p>
      <p>
        <a href="/options">Lodging and helping</a>
      </p>
      <p>
        <a href="/admin/allergies">Allergy list</a>
      </p>
      <p>
        <a href="/admin/song-categories">Song categories</a>
      </p>
      <p>
        <a href="/admin/settings">Settings</a>
      </p>

      <h2>Accounts</h2>

      {roster.status === 'loading' && <p class="form-note">Loading…</p>}

      {roster.status === 'failed' && <ErrorText message={roster.message} />}

      <ErrorText message={error} />

      {roster.status === 'ready' && (
        <Table>
          <thead>
            <tr>
              <th scope="col">Email</th>
              {accountRoles.map((role) => (
                <th key={role} scope="col">
                  {role}
                </th>
              ))}
              <th scope="col">Password</th>
            </tr>
          </thead>
          <tbody>
            {roster.data.accounts.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.email}</td>
                {accountRoles.map((role) => (
                  <td key={role}>
                    <input
                      type="checkbox"
                      checked={entry.roles.includes(role)}
                      disabled={busy}
                      aria-label={`${role} — ${entry.email}`}
                      onChange={(changeEvent) => {
                        void toggle(entry, role, changeEvent.currentTarget.checked)
                      }}
                    />
                  </td>
                ))}
                <td>
                  <SetPassword api={api} email={entry.email} accountId={entry.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <p class="form-note">
        An account with neither is normal — an applicant, or someone invited who has not finished. Member
        opens someone&rsquo;s own details and saying they are coming; admin opens this page. Most people here
        want both.
      </p>
    </GuardedPage>
  )
}

const SetPassword = ({
  api,
  email,
  accountId,
}: {
  api: Pick<ApiClient, 'setAccountPassword'>
  email: string
  accountId: string
}) => {
  const [password, setPassword] = useState('')
  const [state, setState] = useState<'done' | 'failed' | 'idle' | 'saving'>('idle')

  const save = async () => {
    setState('saving')
    try {
      await api.setAccountPassword(accountId, { password })
      setPassword('')
      setState('done')
    } catch {
      setState('failed')
    }
  }

  return (
    <span class="row">
      <input
        type="text"
        autocomplete="off"
        aria-label={`New password for ${email}`}
        placeholder="New password"
        value={password}
        disabled={state === 'saving'}
        onInput={(inputEvent) => {
          setPassword(inputEvent.currentTarget.value)
          setState('idle')
        }}
      />
      <button type="button" disabled={state === 'saving' || password === ''} onClick={() => void save()}>
        Set it
      </button>
      {state === 'done' && (
        <span class="form-note" role="status">
          Set. Tell them what it is — nobody else can read it back.
        </span>
      )}
      {state === 'failed' && (
        <span class="form-error" role="alert">
          Could not set that password.
        </span>
      )}
    </span>
  )
}
