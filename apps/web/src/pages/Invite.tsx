import type { Event, EventOptionTaken, InviteState } from '@sage-burner/shared'

import { MAX_NOTES, MAX_PERSON_NAME } from '@sage-burner/shared'
import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'
import type { StayDraft } from '../stay.ts'

import { isApiError } from '../api/client.ts'
import { ErrorText } from '../components/ErrorText.tsx'
import { FormError, useFormError } from '../components/FormError.tsx'
import { PendingButton } from '../components/PendingButton.tsx'
import { StayFields } from '../components/StayFields.tsx'
import { stayForBurn, stayProblem, stayUpdate } from '../stay.ts'
import { rowsFor } from '../textarea.ts'
import { useSetViewer, useViewer } from '../viewer.tsx'

export type InviteApi = Pick<
  ApiClient,
  'getActiveEvent' | 'getEventOptions' | 'getInviteState' | 'joinEvent' | 'redeemInvite' | 'updateMyStay'
>

/** The burn the form offers to join, and the two lists its stay questions need. */
interface Upcoming {
  event: Event
  options: readonly EventOptionTaken[]
}

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; state: InviteState; upcoming: Upcoming | undefined }
  | { status: 'failed' }

/**
 * The failures redeeming can produce, each wanting different behaviour.
 *
 * A 409 means the invite went while this page was open, or the email is already
 * an account. Either way the answer is not "try again": the same request fails
 * the same way.
 *
 * A 429 is the opposite — the server is spending all the password hashing it will
 * run at once, and waiting a moment is exactly the right advice.
 *
 * `network` is the API client's own code for a request that never reached a
 * server, and its message already says to check the connection. Advice about a
 * connection belongs there and nowhere else: every other branch here is answering
 * a response that did arrive, so telling those callers to check their wifi sends
 * them after the wrong thing.
 *
 * Matched on the code rather than on status 0, which `aborted` also carries — a
 * cancellation is the page's own tidying up and has no business being rendered.
 * Unreachable while this call passes no signal, and the wrong thing to be relying
 * on either way.
 *
 * The near-duplicate 429 copy here and in `Login.tsx` is intentional rather than
 * drift: this page can say "signing up" where that one says "sign-in attempts".
 * If one is edited, decide about the other rather than assuming they must match.
 */
const messageForFailure = (failure: unknown): string => {
  if (!isApiError(failure)) return 'Could not finish signing you up. Please try again.'
  if (failure.status === 409) {
    return 'That invite has already been used, or there is already an account with that email. Ask someone with admin for a fresh link.'
  }
  if (failure.status === 429) return 'Too many sign-ups just now. Wait a few seconds and try again.'
  if (failure.code === 'network') return failure.message

  return 'Could not finish signing you up. Please try again.'
}

/**
 * The burn this page used to only describe (#104).
 *
 * Somebody who has just joined the community is the person most likely to want the
 * next burn, and this is the moment they are paying attention — so the welcome
 * offers it rather than sending them to a start page to find their own way. Its own
 * write, after the token is already spent, so a burn that will not take them costs
 * them nothing they cannot come back for.
 */
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

/**
 * Spending an invitation: the page where someone becomes a member.
 *
 * The controls are `aria-required` rather than natively `required`, and carry no
 * `minLength`, for the reason the application form gives: native validation
 * blocks submission before this handler runs, which would leave the browser
 * deciding the empty cases and this page the rest. The browser's rules are the
 * weaker ones — it accepts `"   "` for a name.
 */
export const Invite = ({ api, token }: { api: InviteApi; token: string }) => {
  const viewer = useViewer()
  const setViewer = useSetViewer()
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [allergies, setAllergies] = useState('')
  const [coming, setComing] = useState(true)
  const [stay, setStay] = useState<StayDraft | undefined>(undefined)
  const [error, setError] = useFormError()
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<'joined' | 'member' | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()

    /**
     * The burn to offer, or nothing.
     *
     * `/events/active` and its options are both public — the second for the reason
     * the places are, that nothing in it is about a person — so the form can name the
     * burn and draw its lodging list without this page's unauthenticated route
     * learning to hand out anything new.
     *
     * Its own failure is swallowed rather than failing the page: the invite is what
     * this page is for, and somebody who cannot be offered a burn can still become a
     * member and pick one afterwards.
     */
    const upcomingBurn = async (): Promise<Upcoming | undefined> => {
      try {
        const { event } = await api.getActiveEvent(controller.signal)
        if (event === null) return undefined

        const { options } = await api.getEventOptions(event.id, controller.signal)
        return { event, options }
      } catch {
        return undefined
      }
    }

    Promise.all([api.getInviteState(token, controller.signal), upcomingBurn()])
      .then(([state, upcoming]) => {
        if (controller.signal.aborted) return

        setLoaded({ status: 'ready', state, upcoming })
        // What they typed on the application. Asked for it twice, a form reads as
        // one that was not listening the first time — and the address doubly so once
        // the invite arrives at it (#30). Still editable: this becomes the login, and
        // somebody may want a different address for that than the one they applied
        // with.
        if (state.name !== null) setName(state.name)
        if (state.email !== null) setEmail(state.email)
        if (upcoming !== undefined) {
          setStay(stayForBurn(upcoming.event.start_date, upcoming.event.end_date))
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ status: 'failed' })
      })

    return () => controller.abort()
  }, [api, token])

  const offered = loaded.status === 'ready' ? loaded.upcoming : undefined

  const joining = offered !== undefined && coming

  /** What is wrong with the form, in words, or nothing — nothing being the signal to send. */
  const problem = (): string | undefined => {
    if (email.trim() === '') return 'Please give us an email address — it becomes your login.'
    if (name.trim() === '') return 'Please tell us your name.'
    if (password === '') return 'Please choose a password.'

    return joining && stay !== undefined ? stayProblem(stay) : undefined
  }

  const submit = async () => {
    const wrong = problem()
    setError(wrong)
    if (wrong !== undefined) return

    setSending(true)
    try {
      const { viewer: signedIn, attendance } = await api.redeemInvite(token, {
        email,
        password,
        name: name.trim(),
        allergies_notes: allergies.trim() === '' ? null : allergies.trim(),
        join_event_id: joining ? offered.event.id : null,
      })
      // The cookie is set server-side, but the shared viewer is populated once on
      // mount and not refetched on client-side navigation — so without this the
      // nav still offers "Log in" to someone holding a valid session. `Login.tsx`
      // does the same thing after its own sign-in.
      if (signedIn !== null) {
        setViewer({
          id: signedIn.account_id,
          name: signedIn.name,
          avatar: signedIn.avatar,
          roles: signedIn.roles,
        })
      }

      // A second write, and deliberately not part of the redemption: that one spends
      // a token which cannot be spent again, so nothing optional may be able to roll
      // it back. Its failure is reported where it happens and leaves somebody signed
      // in and on the list — the details are the one thing here they can come back
      // and change.
      if (attendance !== null && stay !== undefined) {
        try {
          await api.updateMyStay(attendance.event_id, stayUpdate(stay))
        } catch {
          setError('You are in, but those burn details did not save. You can set them on your own page.')
        }
      }

      setDone(attendance === null ? 'member' : 'joined')
    } catch (failure) {
      setError(messageForFailure(failure))
    } finally {
      setSending(false)
    }
  }

  if (done !== undefined) {
    return (
      <section class="page">
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
    // Redeeming would create a second account for the same human, and the page
    // has no way to tell whether that is what they meant.
    return (
      <section class="page">
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
      <section class="page">
        <h1>Your invitation</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (loaded.status === 'failed') {
    return (
      <section class="page">
        <h1>Your invitation</h1>
        <ErrorText message="Could not check this invitation. Please reload the page." />
      </section>
    )
  }

  if (loaded.state.status !== 'outstanding') {
    // Three different dead ends, three different things to do about them — an
    // expired link can be re-sent, a used one probably means you already have an
    // account, and an unknown one is usually a truncated paste.
    const explanation = {
      expired: 'This invitation has expired. Ask someone with admin for a fresh one.',
      used: 'This invitation has already been used. If that was you, log in instead.',
      unknown: 'We do not recognise this invitation link. Check you copied all of it.',
    }[loaded.state.status]

    return (
      <section class="page">
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
    <section class="page">
      <h1>Welcome — let us set you up</h1>

      <p class="form-note">
        This invitation is good for one person. The email and password become your login; the rest is for
        planning. Food is primarily vegetarian, with vegan options.
      </p>

      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
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

        <label class="field">
          <span>Allergies or food you cannot eat (optional)</span>
          <textarea
            name="allergies_notes"
            maxLength={MAX_NOTES}
            rows={rowsFor(allergies)}
            value={allergies}
            onInput={(event) => setAllergies(event.currentTarget.value)}
          />
        </label>

        <p class="form-note">
          We cook together, so this is read by whoever plans the meals. You can change it later.
        </p>

        {offered !== undefined && (
          <>
            <hr />

            {/* Ticked, because almost everybody spending an invite is coming to the
                burn that is next — but offered rather than assumed: being on the list
                is a commitment, and an admin setting a burn up need not be
                attending it. */}
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
