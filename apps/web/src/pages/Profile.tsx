import type { Profile } from '@sage-burner/shared'

import { MAX_CONTACT, MAX_NOTES, MAX_PERSON_NAME } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { PushApi } from '../components/PushToggle.tsx'
import type { YourBurnsApi } from '../components/YourBurns.tsx'

import { isApiError } from '../api/client.ts'
import { FormError, useFormError } from '../components/FormError.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { PushToggle } from '../components/PushToggle.tsx'
import { YourBurns } from '../components/YourBurns.tsx'
import { isMember, useViewer } from '../viewer.tsx'

export type ProfileApi = Pick<ApiClient, 'getMyProfile' | 'updateMyProfile'> & PushApi & YourBurnsApi

type Loaded = { status: 'loading' } | { status: 'ready'; profile: Profile } | { status: 'failed' }

export const ProfilePage = ({ api }: { api: ProfileApi }) => {
  const viewer = useViewer()
  const member = isMember(viewer)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [allergies, setAllergies] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useFormError()

  useEffect(() => {
    if (!member) return undefined

    const controller = new AbortController()

    api
      .getMyProfile(controller.signal)
      .then(({ profile }) => {
        if (controller.signal.aborted) return
        setLoaded({ status: 'ready', profile })
        setName(profile.name ?? '')
        setContact(profile.contact ?? '')
        setAllergies(profile.allergies_notes ?? '')
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ status: 'failed' })
      })

    return () => controller.abort()
  }, [api, member])

  const save = async () => {
    setError(undefined)
    setSaved(false)
    if (name.trim() === '' || contact.trim() === '') {
      setError('Please keep a name and a way to reach you — both are needed for planning.')
      return
    }

    setSaving(true)
    try {
      const { profile } = await api.updateMyProfile({
        name: name.trim(),
        contact: contact.trim(),
        allergies_notes: allergies.trim() === '' ? null : allergies.trim(),
      })
      setLoaded({ status: 'ready', profile })
      setSaved(true)
    } catch (failure) {
      setError(isApiError(failure) ? failure.message : 'Could not save that. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <GuardedPage title="Your details" require="member">
      <h1>Your details</h1>

      <p class="form-note">
        These follow you from burn to burn. Below them is each burn on its own, for what does not: when you
        arrive, where you sleep, what you will help with.
      </p>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && (
        <p class="form-error" role="alert">
          Could not load your details. Please reload the page.
        </p>
      )}

      {loaded.status === 'ready' && (
        <form
          class="form"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault()
            void save()
          }}
        >
          <label class="field">
            <span>Your name</span>
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
            <span>How can we reach you?</span>
            <input
              type="text"
              name="contact"
              maxLength={MAX_CONTACT}
              aria-required
              value={contact}
              onInput={(inputEvent) => setContact(inputEvent.currentTarget.value)}
            />
          </label>

          <label class="field">
            <span>Allergies or food you cannot eat</span>
            <textarea
              name="allergies_notes"
              maxLength={MAX_NOTES}
              value={allergies}
              onInput={(inputEvent) => setAllergies(inputEvent.currentTarget.value)}
            />
          </label>

          <p class="form-note">
            Food is primarily vegetarian, with vegan options. Read by whoever plans the meals, for every burn
            you come to — so correcting it here corrects it everywhere.
          </p>

          {saved && (
            <p class="form-note" role="status">
              Saved.
            </p>
          )}

          <FormError error={error} />

          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}

      <p class="form-note">
        Signed in as {loaded.status === 'ready' ? loaded.profile.email : 'you'}. Changing that address is not
        possible yet — ask someone with admin.
      </p>

      <PushToggle api={api} />

      <YourBurns api={api} />
    </GuardedPage>
  )
}
