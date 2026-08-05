import type { EventOptionsResponse, MyBurn, PaymentStatus } from '@sage-burner/shared'

import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { useBurns } from '../burn.tsx'
import { useAction, useLoad } from '../load.ts'
import { StayForm } from './StayForm.tsx'

export type YourBurnsApi = Pick<
  ApiClient,
  'getMyBurns' | 'joinEvent' | 'leaveEvent' | 'updateMyStay' | 'getEventOptions'
>

/**
 * Every status gets its own sentence.
 *
 * A `Record` rather than a conditional, so a third status would be a type error here
 * instead of quietly reading as one of the two — which is what `partial` did: it
 * showed the same ", not yet paid." as having paid nothing.
 */
const PAYMENT_NOTES: Record<PaymentStatus, string> = {
  unpaid: ', not yet paid.',
  paid: ', and you have paid.',
}

type Options = EventOptionsResponse['options']
type Loaded = { burns: readonly MyBurn[]; past: readonly MyBurn[]; options: Map<string, Options> }

/**
 * The burns on somebody's own page — the one being planned, the ones after it, and
 * their history behind a disclosure.
 *
 * This was a page of its own called "Your burn", singular, from when there was one
 * burn worth showing and it was whichever came next. More than one is planned at a
 * time, so #184 folded it in here: the details above follow you from burn to burn,
 * and each section below is one burn's worth of what does not.
 *
 * The lodging list is only fetched for burns they have actually joined — it is the
 * form's data, and there is no form until then.
 */
export const YourBurns = ({ api }: { api: YourBurnsApi }) => {
  const [showPast, setShowPast] = useState(false)

  // The bar's own list, which this page is the only thing that changes.
  const { reload: refreshBurns } = useBurns()
  const { loaded, reload } = useLoad<Loaded>(
    async (signal) => {
      const { coming, past } = await api.getMyBurns(signal)
      const joined = coming.filter((burn) => burn.attendance !== null)
      const lists = await Promise.all(
        joined.map(async (burn) => {
          const { options } = await api.getEventOptions(burn.event.id, signal)
          return [burn.event.id, options] as const
        }),
      )

      return { burns: coming, past, options: new Map(lists) }
    },
    { fallback: 'Could not load your burns.' },
  )

  const { busy, error, run } = useAction(reload)

  /**
   * Run something, with words for the statuses that mean it was refused.
   *
   * A status map rather than one message for 409, which is what this was and which
   * left the join path unable to say anything useful: joining a burn that has just
   * ended answers **404**, deliberately — an ended burn and an id that never existed
   * get the same answer, so an id cannot be probed for existence. Under a 409-only
   * rule that member was told to try again, which is advice that cannot help.
   */
  const act = (change: () => Promise<unknown>, refusals: Readonly<Record<number, string>>) => {
    run(
      change,
      (failure: unknown) =>
        (isApiError(failure) ? refusals[failure.status] : undefined) ??
        'That did not work. Please try again.',
    )
  }

  return (
    <>
      {loaded.status === 'loading' && <p class="form-note">Loading your burns…</p>}

      {loaded.status === 'failed' && (
        <p class="form-error" role="alert">
          {loaded.message}
        </p>
      )}

      {error !== undefined && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      {loaded.status === 'ready' && loaded.data.burns.length === 0 && (
        <>
          <hr />
          <p class="form-note">
            There is no burn planned at the moment. When the next one is announced it will show up here.
          </p>
        </>
      )}

      {loaded.status === 'ready' &&
        loaded.data.burns.map((burn) => (
          <section key={burn.event.id}>
            <hr />
            <h2>{burn.event.name}</h2>
            <p class="form-note">
              {burn.event.start_date} → {burn.event.end_date}
            </p>

            {burn.attendance === null ? (
              <>
                <p>You have not said whether you are coming.</p>
                <p class="row">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      act(
                        async () => {
                          await api.joinEvent(burn.event.id)
                          // The bar's list is fetched once for the session, so without
                          // this the burn you just joined is not selectable and every
                          // burn-scoped page says you are not coming to one — until a
                          // reload, which is not a thing to ask of anybody.
                          refreshBurns()
                        },
                        { 404: 'That burn is over, so you cannot join it now.' },
                      )
                    }
                  >
                    I am coming
                  </button>
                </p>
              </>
            ) : (
              <>
                <p role="status">
                  You are on the list for {burn.event.name}
                  {PAYMENT_NOTES[burn.attendance.payment_status]}
                </p>

                <StayForm
                  api={api}
                  eventId={burn.event.id}
                  attendance={burn.attendance}
                  lodgingOptions={(loaded.data.options.get(burn.event.id) ?? []).filter(
                    (option) => option.kind === 'lodging',
                  )}
                  helpingOptions={(loaded.data.options.get(burn.event.id) ?? []).filter(
                    (option) => option.kind === 'helping',
                  )}
                  taken={Object.fromEntries(
                    (loaded.data.options.get(burn.event.id) ?? []).map((option) => [option.id, option.taken]),
                  )}
                  // Reloaded rather than spliced: the `taken` counts move when a member
                  // changes where they are sleeping, and a stale map leaves the option
                  // they just left reading as full — now disabled, since it is no longer
                  // theirs — which a native select cannot pick back.
                  onSaved={reload}
                />

                <p class="row">
                  <button
                    type="button"
                    class="link-button"
                    disabled={busy}
                    onClick={() =>
                      act(
                        async () => {
                          await api.leaveEvent(burn.event.id)
                          refreshBurns()
                        },
                        {
                          409: 'You have already paid for this burn, so someone with admin needs to sort this one out with you.',
                          404: 'That burn is over, so there is nothing left to withdraw from.',
                        },
                      )
                    }
                  >
                    I cannot come after all
                  </button>
                </p>
              </>
            )}
          </section>
        ))}

      {loaded.status === 'ready' && loaded.data.past.length > 0 && (
        <>
          <hr />
          <p class="row">
            <button type="button" class="link-button" onClick={() => setShowPast(!showPast)}>
              {showPast ? 'Hide past burns' : '…show past burns'}
            </button>
          </p>

          {showPast && (
            <ul>
              {loaded.data.past.map((burn) => (
                <li key={burn.event.id}>
                  {burn.event.name} — {burn.event.start_date} → {burn.event.end_date}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  )
}
