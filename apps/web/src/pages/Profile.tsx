import type { Profile, AllergyItem } from '@sage-burner/shared'

import { MAX_CONTACT, MAX_INTRODUCTION, MAX_NOTES, MAX_PERSON_NAME } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { ConnectionsApi } from '../components/ConnectionsField.tsx'
import type { PasskeysApi } from '../components/PasskeysField.tsx'
import type { PushApi } from '../components/PushToggle.tsx'
import type { WaysInApi } from '../components/WaysInField.tsx'
import type { YourBurnsApi } from '../components/YourBurns.tsx'

import { AvatarField } from '../components/AvatarField.tsx'
import { ConnectionsField } from '../components/ConnectionsField.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { FormError } from '../components/FormError.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { LogOutButton } from '../components/LogOutButton.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { PasskeysField } from '../components/PasskeysField.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { PushToggle } from '../components/PushToggle.tsx'
import { WaysInField } from '../components/WaysInField.tsx'
import { YourBurns } from '../components/YourBurns.tsx'
import { stillUploading } from '../image-upload.ts'
import { useAction, useLoad, useLoadInto } from '../load.ts'
import { rowsFor } from '../textarea.ts'
import { isMember, useViewer } from '../viewer.tsx'

export type ProfileApi = Pick<
  ApiClient,
  | 'getMyProfile'
  | 'updateMyProfile'
  | 'logout'
  | 'setMyAvatar'
  | 'removeMyAvatar'
  | 'getAllergyItems'
  | 'uploadImage'
> &
  ConnectionsApi &
  PasskeysApi &
  WaysInApi &
  PushApi &
  YourBurnsApi

export const ProfilePage = ({ api }: { api: ProfileApi }) => {
  const viewer = useViewer()
  const member = isMember(viewer)
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [allergies, setAllergies] = useState('')
  const [introduction, setIntroduction] = useState('')
  const [ticked, setTicked] = useState<readonly string[]>([])
  const [saved, setSaved] = useState(false)

  const { loaded } = useLoadInto(
    async (signal) => (await api.getMyProfile(signal)).profile,
    (profile: Profile) => {
      setName(profile.name ?? '')
      setContact(profile.contact ?? '')
      setAllergies(profile.allergies_notes ?? '')
      setIntroduction(profile.introduction ?? '')
      setTicked(profile.allergy_item_ids)
    },
    { enabled: member, fallback: 'Could not load your details. Please reload the page.' },
  )

  // Its own load, and its own failure: the vocabulary is a nicety beside the free
  // text, so not having it must not cost somebody the page their name is on. No
  // `fallback` either — nothing reads this one's message.
  const { loaded: vocabulary } = useLoad(async (signal) => (await api.getAllergyItems(signal)).items, {
    enabled: member,
  })
  const items: readonly AllergyItem[] = vocabulary.status === 'ready' ? vocabulary.data : []

  const { busy: saving, formError, setError, run } = useAction()

  const save = () => {
    setSaved(false)
    if (name.trim() === '' || contact.trim() === '') {
      setError('Please keep a name and a way to reach you — both are needed for planning.')
      return
    }

    run(async () => {
      await api.updateMyProfile({
        name: name.trim(),
        contact: contact.trim(),
        allergies_notes: allergies.trim() === '' ? null : allergies.trim(),
        allergy_item_ids: [...ticked],
        introduction: introduction.trim() === '' ? null : introduction.trim(),
      })
      setSaved(true)
    }, 'Could not save that. Please try again.')
  }

  return (
    <GuardedPage title="Your details" require="approved">
      <h1>Your details</h1>

      {member ? (
        <p class="form-note">
          These follow you from burn to burn. Below them is each burn on its own, for what does not: when you
          arrive, where you sleep, what you will help with.
        </p>
      ) : (
        // An account holding `admin` and not `member` (#396). Organising without attending is
        // coherent, so the half of this page that is about a stay has nothing to say to them —
        // and the half that is about the account has everything, notifications included.
        <p class="form-note">
          Your picture, how people reach you, and how you sign in. Say you are coming to a burn — under
          Organise → Accounts — and what you bring and where you sleep appear here too.
        </p>
      )}

      {member && loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {member && loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {member && loaded.status === 'ready' && (
        <form
          class="form"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault()
            save()
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

          {/* Above the allergies rather than below them: it is the part of this page
              other members read, and the part somebody has actually come here to write.
              `uploadImage` is passed, so it takes a paste, a drop and a photograph from a
              phone like every other markdown field members read (#379). */}
          <MarkdownField
            label="A little about you"
            placeholder="Who you are, what you are bringing, a picture or two…"
            value={introduction}
            maxLength={MAX_INTRODUCTION}
            rows={5}
            upload={api.uploadImage}
            onInput={setIntroduction}
          />

          <p class="form-note">
            Shown on your page, which every member reaches by clicking your name. Nobody outside the gathering
            sees it.
          </p>

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
              rows={rowsFor(allergies)}
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

          <FormError error={formError} />

          <PendingButton
            busy={saving}
            label="Save"
            busyLabel="Saving…"
            type="submit"
            disabled={stillUploading(introduction)}
          />
        </form>
      )}

      {member && (
        <p class="form-note">
          Signed in as {loaded.status === 'ready' ? loaded.data.email : 'you'}. Changing that address is not
          possible yet — ask someone with admin.
        </p>
      )}

      <AvatarField api={api} />

      <ConnectionsField api={api} />

      <PasskeysField api={api} />

      <WaysInField api={api} />

      <LogOutButton api={api} />

      <PushToggle api={api} />

      {/* The burn-shaped half: `joinEvent` is `requireMember`, so somebody organising
          without attending would be offered a button the API refuses. */}
      {member && <YourBurns api={api} />}
    </GuardedPage>
  )
}
