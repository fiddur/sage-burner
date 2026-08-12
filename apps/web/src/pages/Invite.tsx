import type { AllergyItem, Event, EventOptionTaken, InviteState } from '@sage-burner/shared'

import { MAX_PERSON_NAME } from '@sage-burner/shared'
import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { StayDraft } from '../stay.ts'

import { isApiError } from '../api/client.ts'
import { AllergiesField } from '../components/AllergiesField.tsx'
import { ErrorText } from '../components/ErrorText.tsx'
import { FormError } from '../components/FormError.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { StayFields } from '../components/StayFields.tsx'
import { useAction, useLoadInto } from '../load.ts'
import { stayForBurn, stayProblem, stayUpdate } from '../stay.ts'
import { useSetViewer, useViewer } from '../viewer.tsx'

export type InviteApi = Pick<
  ApiClient,
  | 'getActiveEvent'
  | 'getAllergyItems'
  | 'getEventOptions'
  | 'getInviteState'
  | 'joinEvent'
  | 'redeemInvite'
  | 'updateMyStay'
>

interface Upcoming {
  event: Event
  options: readonly EventOptionTaken[]
}

interface Invited {
  state: InviteState
  upcoming: Upcoming | undefined
  allergyItems: readonly AllergyItem[]
}

const upcomingBurn = async (api: InviteApi, signal: AbortSignal): Promise<Upcoming | undefined> => {
  try {
    const { event } = await api.getActiveEvent(signal)
    if (event === null) return undefined

    const { options } = await api.getEventOptions(event.id, signal)
    return { event, options }
  } catch {
    return undefined
  }
}

const messageForFailure = (failure: unknown): string => {
  if (!isApiError(failure)) return 'Could not finish signing you up. Please try again.'
  if (failure.status === 409) {
    return 'That invite has already been used, or there is already an account with that email. Ask someone with admin for a fresh link.'
  }
  if (failure.status === 429) return 'Too many sign-ups just now. Wait a few seconds and try again.'
  if (failure.code === 'network') return failure.message

  return 'Could not finish signing you up. Please try again.'
}

const OpenBurnOffer = ({ api, burn }: { api: Pick<InviteApi, 'joinEvent'>; burn: Event | undefined }) => {
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const [failed, setFailed] = useState(false)

  if (burn === undefined) {
    return <p>There is no burn open to join just now — the next one will be here when it is announced.</p>
  }

  if (added) {
    return (
      <p role="status">
        You are on the list for {burn.name}. Arrival and lodging are on your own page whenever you want them.
      </p>
    )
  }

  const join = async () => {
    setAdding(true)
    setFailed(false)
    try {
      await api.joinEvent(burn.id)
      setAdded(true)
    } catch {
      setFailed(true)
    } finally {
      setAdding(false)
    }
  }

  return (
    <>
      {failed && <ErrorText message="Could not add you to that burn. You can join it from your own page." />}

      <p>
        <button type="button" disabled={adding} onClick={() => void join()}>
          {adding ? 'Adding you…' : `Join ${burn.name} (${burn.start_date} → ${burn.end_date})`}
        </button>
      </p>
    </>
  )
}

export const Invite = ({ api, token }: { api: InviteApi; token: string }) => {
  const viewer = useViewer()
  const setViewer = useSetViewer()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [allergies, setAllergies] = useState('')
  const [ticked, setTicked] = useState<readonly string[]>([])
  const [coming, setComing] = useState(true)
  const [stay, setStay] = useState<StayDraft | undefined>(undefined)
  const [done, setDone] = useState<'joined' | 'member' | undefined>(undefined)

  const { loaded } = useLoadInto(
    async (signal): Promise<Invited> => {
      const [state, upcoming, allergyList] = await Promise.all([
        api.getInviteState(token, signal),
        upcomingBurn(api, signal),
        api.getAllergyItems(signal),
      ])

      return { state, upcoming, allergyItems: allergyList.items }
    },
    ({ state, upcoming }) => {
      if (state.name !== null) setName(state.name)
      if (state.email !== null) setEmail(state.email)
      if (upcoming !== undefined) {
        setStay(stayForBurn(upcoming.event.start_date, upcoming.event.end_date))
      }
    },
    { key: token },
  )

  const { busy: sending, formError: error, setError, run } = useAction()

  const offered = loaded.status === 'ready' ? loaded.data.upcoming : undefined

  const joining = offered !== undefined && coming

  const problem = (): string | undefined => {
    if (email.trim() === '') return 'Please give us an email address — it becomes your login.'
    if (name.trim() === '') return 'Please tell us your name.'
    if (password === '') return 'Please choose a password.'

    return joining && stay !== undefined ? stayProblem(stay) : undefined
  }

  const submit = () => {
    const wrong = problem()
    setError(wrong)
    if (wrong !== undefined) return

    run(async () => {
      const { viewer: signedIn, attendance } = await api.redeemInvite(token, {
        email,
        password,
        name: name.trim(),
        allergies_notes: allergies.trim() === '' ? null : allergies.trim(),
        allergy_item_ids: [...ticked],
        join_event_id: joining ? offered.event.id : null,
      })
      if (signedIn !== null) {
        setViewer({
          id: signedIn.account_id,
          name: signedIn.name,
          avatar: signedIn.avatar,
          roles: signedIn.roles,
        })
      }

      if (attendance !== null && stay !== undefined) {
        try {
          await api.updateMyStay(attendance.event_id, stayUpdate(stay))
        } catch {
          setError('You are in, but those burn details did not save. You can set them on your own page.')
        }
      }

      setDone(attendance === null ? 'member' : 'joined')
    }, messageForFailure)
  }

  if (done !== undefined) {
    return (
      <section class="page column">
        <h1>Welcome</h1>
        <p role="status">
          {done === 'joined'
            ? 'You are in, signed in, and on the list. Everything you just filled in can be changed later on your own page.'
            : 'You are in, and signed in.'}
        </p>

        {done === 'member' && <OpenBurnOffer api={api} burn={offered?.event} />}

        <FormError error={error} />

        <p class="home-actions">
          <a href="/">Go to the start page</a>
        </p>
      </section>
    )
  }

  if (viewer.status === 'signed-in') {
    return (
      <section class="page column">
        <h1>You are already signed in</h1>
        <p>
          Log out first if you meant to redeem this invite for a different person, or{' '}
          <a href="/">go to the start page</a>.
        </p>
      </section>
    )
  }

  if (loaded.status === 'loading') {
    return (
      <section class="page column">
        <h1>Your invitation</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (loaded.status === 'failed') {
    return (
      <section class="page column">
        <h1>Your invitation</h1>
        <ErrorText message="Could not check this invitation. Please reload the page." />
      </section>
    )
  }

  if (loaded.data.state.status !== 'outstanding') {
    const explanation = {
      expired: 'This invitation has expired. Ask someone with admin for a fresh one.',
      used: 'This invitation has already been used. If that was you, log in instead.',
      revoked: 'This invitation has been withdrawn. Ask someone with admin for a fresh one.',
      full: 'This invitation has been used as many times as it allows. Ask someone with admin.',
      unknown: 'We do not recognise this invitation link. Check you copied all of it.',
    }[loaded.data.state.status]

    return (
      <section class="page column">
        <h1>Your invitation</h1>
        <ErrorText message={explanation} />
        <p class="home-actions">
          <a href="/login">Log in</a>
          <a href="/">Start page</a>
        </p>
      </section>
    )
  }

  return (
    <section class="page column">
      <h1>Welcome — let us set you up</h1>

      <p class="form-note">
        This invitation is good for one person. The email and password become your login; the rest is for
        planning. Food is primarily vegetarian, with vegan options.
      </p>

      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label class="field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            autocomplete="username"
            aria-required
            value={email}
            onInput={(event) => setEmail(event.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>Password</span>
          <input
            type="password"
            name="password"
            autocomplete="new-password"
            aria-required
            value={password}
            onInput={(event) => setPassword(event.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>Your name</span>
          <input
            type="text"
            name="name"
            maxLength={MAX_PERSON_NAME}
            aria-required
            value={name}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>

        <AllergiesField
          items={loaded.status === 'ready' ? loaded.data.allergyItems : []}
          ticked={ticked}
          notes={allergies}
          onTicked={setTicked}
          onNotes={setAllergies}
        />

        <p class="form-note">
          We cook together, so this is read by whoever plans the meals. You can change it later.
        </p>

        {offered !== undefined && (
          <>
            <hr />

            <label class="field-inline">
              <input
                type="checkbox"
                checked={coming}
                onChange={(event) => setComing(event.currentTarget.checked)}
              />
              <span>
                I am coming to {offered.event.name} ({offered.event.start_date} → {offered.event.end_date})
              </span>
            </label>

            {coming && stay !== undefined && (
              <StayFields
                draft={stay}
                onChange={setStay}
                lodgingOptions={offered.options.filter((option) => option.kind === 'lodging')}
                helpingOptions={offered.options.filter((option) => option.kind === 'helping')}
                lodgingTaken={Object.fromEntries(offered.options.map((option) => [option.id, option.taken]))}
              />
            )}
          </>
        )}

        <FormError error={error} />

        <PendingButton busy={sending} label="Join" busyLabel="Setting you up…" type="submit" />
      </form>
    </section>
  )
}
