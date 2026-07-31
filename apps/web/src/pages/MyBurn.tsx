import type { MyAttendanceResponse, PaymentStatus } from '@sage-burner/shared'

import { useEffect, useState } from 'preact/hooks'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { StayForm } from '../components/StayForm.tsx'
import { isMember, useViewer } from '../viewer.tsx'

/**
 * Every status gets its own sentence.
 *
 * A `Record` rather than a conditional, so adding a fourth status is a
 * type error here instead of quietly reading as one of the others — which is
 * what `partial` did: it showed the same ", not yet paid." as having paid
 * nothing.
 */
const PAYMENT_NOTES: Record<PaymentStatus, string> = {
  unpaid: ', not yet paid.',
  paid: ', and you have paid.',
}

const paymentNote = (status: PaymentStatus) => PAYMENT_NOTES[status]

export type MyBurnApi = Pick<
  ApiClient,
  'getMyAttendance' | 'joinActiveEvent' | 'leaveActiveEvent' | 'updateMyStay'
>

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; mine: MyAttendanceResponse }
  | { status: 'failed'; message: string }

export const MyBurn = ({ api }: { api: MyBurnApi }) => {
  const viewer = useViewer()
  const member = isMember(viewer)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const load = (signal?: AbortSignal) =>
    api
      .getMyAttendance(signal)
      .then((mine) => {
        if (signal?.aborted !== true) setLoaded({ status: 'ready', mine })
      })
      .catch((failure: unknown) => {
        if (signal?.aborted === true) return
        setLoaded({
          status: 'failed',
          message: isApiError(failure) ? failure.message : 'Could not load the burn.',
        })
      })

  useEffect(() => {
    if (!member) return undefined

    const controller = new AbortController()
    void load(controller.signal)

    return () => {
      controller.abort()
    }
  }, [api, member])

  const act = async (change: () => Promise<unknown>, whenRefused: string) => {
    setBusy(true)
    setError(undefined)
    try {
      await change()
      await load()
    } catch (failure) {
      setError(
        isApiError(failure) && failure.status === 409 ? whenRefused : 'That did not work. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (viewer.status === 'loading') {
    return (
      <section class="page">
        <h1>Your burn</h1>
        <p class="form-note">One moment…</p>
      </section>
    )
  }

  if (!member) {
    return (
      <section class="page">
        <h1>Your burn</h1>
        <p>
          This is for members. <a href="/apply">Apply to join</a>, or <a href="/login">log in</a> if you
          already have an account.
        </p>
      </section>
    )
  }

  return (
    <section class="page">
      <h1>Your burn</h1>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

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

      {loaded.status === 'ready' && loaded.mine.event === null && (
        <p class="form-note">
          There is no burn open at the moment. When the next one is announced it will show up here.
        </p>
      )}

      {loaded.status === 'ready' && loaded.mine.event !== null && (
        <>
          <h2>{loaded.mine.event.name}</h2>

          {loaded.mine.attendance === null ? (
            <>
              <p>You have not said whether you are coming.</p>
              <p class="row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(api.joinActiveEvent, 'That burn is no longer open.')}
                >
                  I am coming
                </button>
              </p>
            </>
          ) : (
            <>
              <p role="status">
                You are on the list for {loaded.mine.event.name}
                {paymentNote(loaded.mine.attendance.payment_status)}
              </p>
              <StayForm
                api={api}
                attendance={loaded.mine.attendance}
                onSaved={(saved) =>
                  setLoaded({ status: 'ready', mine: { ...loaded.mine, attendance: saved } })
                }
              />

              <p class="row">
                <button
                  type="button"
                  class="link-button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      api.leaveActiveEvent,
                      'You have already paid for this burn, so an organiser needs to sort this one out with you.',
                    )
                  }
                >
                  I cannot come after all
                </button>
              </p>
            </>
          )}
        </>
      )}
    </section>
  )
}
