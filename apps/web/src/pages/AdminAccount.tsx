import type { AdminAccountDetail, AllergyItem } from '@sage-burner/shared'

import { MAX_PERSON_NAME, oauthProviderInfo } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { AllergiesField } from '../components/AllergiesField.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { FormError } from '../components/FormError.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { SetPassword } from '../components/SetPassword.tsx'
import { useAction, useLoad, useLoadInto } from '../load.ts'
import { isAdmin, useViewer } from '../viewer.tsx'

export type AdminAccountApi = Pick<
  ApiClient,
  'getAdminAccount' | 'updateAdminAccount' | 'setAccountPassword' | 'getAllergyItems'
>

const waysIn = (detail: AdminAccountDetail): string => {
  const ways = [
    detail.has_password ? 'a password' : undefined,
    detail.passkeys === 0 ? undefined : detail.passkeys === 1 ? 'a passkey' : `${detail.passkeys} passkeys`,
    ...detail.identities.map((provider) => oauthProviderInfo[provider].label),
  ].filter((way) => way !== undefined)

  if (ways.length === 0) return 'No way in yet — no password, no passkey, no linked sign-in.'

  return `Signs in with ${ways.join(', ')}.`
}

export const AdminAccount = ({ api, accountId }: { api: AdminAccountApi; accountId: string }) => {
  const viewer = useViewer()
  const admin = isAdmin(viewer)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [allergies, setAllergies] = useState('')
  const [ticked, setTicked] = useState<readonly string[]>([])
  const [saved, setSaved] = useState(false)

  const { loaded, reload } = useLoadInto(
    async (signal) => (await api.getAdminAccount(accountId, signal)).account,
    (detail: AdminAccountDetail) => {
      setName(detail.name ?? '')
      setEmail(detail.email)
      setAllergies(detail.allergies_notes ?? '')
      setTicked(detail.allergy_item_ids)
    },
    { enabled: admin, key: accountId, fallback: 'Could not load that account.' },
  )

  const { loaded: vocabulary } = useLoad(async (signal) => (await api.getAllergyItems(signal)).items, {
    enabled: admin,
  })
  const items: readonly AllergyItem[] = vocabulary.status === 'ready' ? vocabulary.data : []

  const { busy: saving, formError, setError, run } = useAction(reload)

  const save = () => {
    setSaved(false)
    if (name.trim() === '' || email.trim() === '') {
      setError('A name and an address are both needed.')
      return
    }

    run(
      async () => {
        await api.updateAdminAccount(accountId, {
          name: name.trim(),
          email: email.trim(),
          allergies_notes: allergies.trim() === '' ? null : allergies.trim(),
          allergy_item_ids: [...ticked],
        })
        setSaved(true)
      },
      (failure: unknown) =>
        isApiError(failure) && failure.status === 409
          ? 'Another account already signs in with that address.'
          : 'Could not save that. Please try again.',
    )
  }

  return (
    <GuardedPage title="Account" require="admin" width="column">
      <p>
        <a href="/admin">← Organise</a>
      </p>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && (
        <>
          <h1>{loaded.data.name ?? loaded.data.email}</h1>
          <p class="form-note">
            {loaded.data.roles.length === 0 ? 'No role yet' : loaded.data.roles.join(' and ')} · signed up{' '}
            {loaded.data.created_at.slice(0, 10)}
          </p>

          <form
            class="form"
            onSubmit={(submitEvent) => {
              submitEvent.preventDefault()
              save()
            }}
          >
            <label class="field">
              <span>Real name</span>
              <input
                type="text"
                name="name"
                maxLength={MAX_PERSON_NAME}
                aria-required
                value={name}
                onInput={(inputEvent) => setName(inputEvent.currentTarget.value)}
              />
            </label>

            <label class="field">
              <span>Login address</span>
              <input
                type="email"
                name="email"
                autocomplete="off"
                aria-required
                value={email}
                onInput={(inputEvent) => setEmail(inputEvent.currentTarget.value)}
              />
            </label>

            <p class="form-note">
              The address they sign in with, and where their mail goes. Changing it here does not touch the
              ways of reaching them that they put on their own page.
            </p>

            <AllergiesField
              items={items}
              ticked={ticked}
              notes={allergies}
              onTicked={setTicked}
              onNotes={setAllergies}
            />

            <p class="form-note">
              Where the free text names something on the list, tick it and take it out of the text — the ticks
              are what the meal plan counts.
            </p>

            {saved && (
              <p class="form-note" role="status">
                Saved.
              </p>
            )}

            <FormError error={formError} />

            <PendingButton busy={saving} label="Save" busyLabel="Saving…" type="submit" />
          </form>

          <h2>Ways in</h2>

          <p class="form-note">{waysIn(loaded.data)}</p>

          <SetPassword api={api} email={loaded.data.email} accountId={accountId} onSet={reload} />
        </>
      )}
    </GuardedPage>
  )
}
