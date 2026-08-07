import type { Profile, AllergyItem } from '@sage-burner/shared'

import { MAX_CONTACT, MAX_NOTES, MAX_PERSON_NAME } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { PasskeysApi } from '../components/PasskeysField.tsx'
import type { PushApi } from '../components/PushToggle.tsx'
import type { YourBurnsApi } from '../components/YourBurns.tsx'

import { isApiError } from '../api/client.ts'
import { AvatarField } from '../components/AvatarField.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { FormError, useFormError } from '../components/FormError.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { LogOutButton } from '../components/LogOutButton.tsx'
import { PasskeysField } from '../components/PasskeysField.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { PushToggle } from '../components/PushToggle.tsx'
import { YourBurns } from '../components/YourBurns.tsx'
import { isMember, useViewer } from '../viewer.tsx'

export type ProfileApi = Pick<
  ApiClient,
  'getMyProfile' | 'updateMyProfile' | 'logout' | 'setMyAvatar' | 'removeMyAvatar' | 'getAllergyItems'
> &
  PasskeysApi &
  PushApi &
  YourBurnsApi

type Loaded = { status: 'loading' } | { status: 'ready'; profile: Profile } | { status: 'failed' }

export const ProfilePage = ({ api }: { api: ProfileApi }) => {
  const viewer = useViewer()
  const member = isMember(viewer)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [allergies, setAllergies] = useState('')
  const [ticked, setTicked] = useState<readonly string[]>([])
  const [items, setItems] = useState<readonly AllergyItem[]>([])
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
        setTicked(profile.allergy_item_ids)
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ status: 'failed' })
      })

    // Its own request, and its own failure: the vocabulary is a nicety beside the
    // free text, so not having it must not cost somebody the page their name is on.
    api
      .getAllergyItems(controller.signal)
      .then(({ items: found }) => {
        if (!controller.signal.aborted) setItems(found)
      })
      .catch(() => undefined)

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
        allergy_item_ids: [...ticked],
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
        <ErrorText message="Could not load your details. Please reload the page." />
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

          {items.length > 0 && (
            <fieldset class="field">
              <legend>Allergies or food you cannot eat</legend>
              {items.map((item) => (
                <label key={item.id} class="field-inline">
                  <input
                    type="checkbox"
                    checked={ticked.includes(item.id)}
                    onChange={(changed) =>
                      setTicked((current) =>
                        changed.currentTarget.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </fieldset>
          )}

          <label class="field">
            <span>
              {items.length > 0 ? 'Anything else you cannot eat' : 'Allergies or food you cannot eat'}
            </span>
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

          <PendingButton busy={saving} label="Save" busyLabel="Saving…" type="submit" />
        </form>
      )}

      <p class="form-note">
        Signed in as {loaded.status === 'ready' ? loaded.profile.email : 'you'}. Changing that address is not
        possible yet — ask someone with admin.
      </p>

      <AvatarField api={api} />

      <PasskeysField api={api} />

      <LogOutButton api={api} />

      <PushToggle api={api} />

      <YourBurns api={api} />
    </GuardedPage>
  )
}
