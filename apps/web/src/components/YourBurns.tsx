import type { EventOptionsResponse, MyBurn, PaymentStatus } from '@sage-burner/shared'

import { useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { useBurns } from '../burn.tsx'
import { useAction, useLoad } from '../load.ts'
import { useViewer } from '../viewer.tsx'
import { ErrorText } from './ErrorText.tsx'
import { HandOverPlace } from './HandOverPlace.tsx'
import { StayForm } from './StayForm.tsx'

export type YourBurnsApi = Pick<
  ApiClient,
  | 'getMyBurns'
  | 'joinEvent'
  | 'leaveEvent'
  | 'updateMyStay'
  | 'getEventOptions'
  | 'getMembers'
  | 'transferMyPlace'
>

const PAYMENT_NOTES: Record<PaymentStatus, string> = {
  unpaid: ', not yet paid.',
  paid: ', and you have paid.',
}

type Options = EventOptionsResponse['options']
type Loaded = { burns: readonly MyBurn[]; past: readonly MyBurn[]; options: Map<string, Options> }

export const YourBurns = ({ api }: { api: YourBurnsApi }) => {
  const [showPast, setShowPast] = useState(false)
  const viewer = useViewer()

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

      {loaded.status === 'failed' && <ErrorText message={loaded.message} />}

      <ErrorText message={error} />

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
                  onSaved={reload}
                />

                {burn.attendance.payment_status === 'paid' ? (
                  <HandOverPlace
                    api={api}
                    eventId={burn.event.id}
                    myAccountId={viewer.account?.id}
                    onDone={() => {
                      refreshBurns()
                      void reload()
                    }}
                  />
                ) : (
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
                            409: 'You have paid for this burn — hand your place to somebody else instead.',
                            404: 'That burn is over, so there is nothing left to withdraw from.',
                          },
                        )
                      }
                    >
                      I cannot come after all
                    </button>
                  </p>
                )}
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
