import type { AllergyItem, Profile } from '@sage-burner/shared'

import { MAX_CONTACT, MAX_INTRODUCTION, MAX_PERSON_NAME } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { ConnectionsApi } from '../components/ConnectionsField.tsx'
import type { PasskeysApi } from '../components/PasskeysField.tsx'
import type { PicturesApi } from '../components/PicturesField.tsx'
import type { PushToggleApi } from '../components/PushToggle.tsx'
import type { WaysInApi } from '../components/WaysInField.tsx'
import type { YourBurnsApi } from '../components/YourBurns.tsx'

import { AllergiesField } from '../components/AllergiesField.tsx'
import { AvatarField } from '../components/AvatarField.tsx'
import { ConnectionsField } from '../components/ConnectionsField.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { FormError } from '../components/FormError.tsx'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { LogOutButton } from '../components/LogOutButton.tsx'
import { MarkdownField } from '../components/MarkdownField.tsx'
import { PasskeysField } from '../components/PasskeysField.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { PicturesField } from '../components/PicturesField.tsx'
import { PushToggle } from '../components/PushToggle.tsx'
import { WaysInField } from '../components/WaysInField.tsx'
import { YourBurns } from '../components/YourBurns.tsx'
import { stillUploading } from '../image-upload.ts'
import { useAction, useLoad, useLoadInto } from '../load.ts'
import { isApproved, isMember, useViewer } from '../viewer.tsx'

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
  PicturesApi &
  WaysInApi &
  PushToggleApi &
  YourBurnsApi

export const ProfilePage = ({ api }: { api: ProfileApi }) => {
  const viewer = useViewer()
  const member = isMember(viewer)
  const approved = isApproved(viewer)
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
    { enabled: approved, fallback: 'Could not load your details. Please reload the page.' },
  )

  const { loaded: vocabulary } = useLoad(async (signal) => (await api.getAllergyItems(signal)).items, {
    enabled: approved,
  })
  const items: readonly AllergyItem[] = vocabulary.status === 'ready' ? vocabulary.data : []

  const { busy: saving, formError, setError, run } = useAction()

  const email = loaded.status === 'ready' ? loaded.data.email : undefined

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
    <GuardedPage title="Your details" require="approved" width="column">
      <h1>Your details</h1>

      {member ? (
        <p class="form-note">
          These follow you from burn to burn. Below them is each burn on its own, for what does not: when you
          arrive, where you sleep, what you will help with.
        </p>
      ) : (
        <p class="form-note">
          These follow you from burn to burn. Say you are coming to one — under Organise → Accounts — and what
          you bring and where you sleep appear here too.
        </p>
      )}

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      {loaded.status === 'ready' && (
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

          <AllergiesField
            items={items}
            ticked={ticked}
            notes={allergies}
            onTicked={setTicked}
            onNotes={setAllergies}
          />

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

      <AvatarField api={api} />

      <ConnectionsField api={api} loginAddress={email} />

      <PicturesField api={api} />

      <PasskeysField api={api} />

      <WaysInField api={api} />

      <p class="form-note">
        Signed in as {email ?? 'you'}. To change that address, ask someone with admin — they can set it.
      </p>

      <LogOutButton api={api} />

      <PushToggle api={api} />

      {member && <YourBurns api={api} />}
    </GuardedPage>
  )
}
