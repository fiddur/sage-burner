import type { PaymentStatus } from '@sage-burner/shared'

import type { ApiClient } from '../api/client.ts'

import { isApiError } from '../api/client.ts'
import { GuardedPage } from '../components/GuardedPage.tsx'
import { StayForm } from '../components/StayForm.tsx'
import { useAction, useLoad } from '../load.ts'
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
  'getMyAttendance' | 'joinActiveEvent' | 'leaveActiveEvent' | 'updateMyStay' | 'getEventOptions'
>

export const MyBurn = ({ api }: { api: MyBurnApi }) => {
  const viewer = useViewer()
  const member = isMember(viewer)
  const { loaded, reload } = useLoad(
    async (signal) => {
      const mine = await api.getMyAttendance(signal)
      // The lodging list belongs to the burn, so it is only worth asking for once
      // there is one.
      const lodging = mine.event === null ? [] : (await api.getEventOptions(mine.event.id, signal)).options

      return { mine, lodging }
    },
    { enabled: member, fallback: 'Could not load the burn.' },
  )

  const { busy, error, run } = useAction(reload)

  // A 409 here always means the same class of thing — the burn moved on — but what
  // exactly moved differs per action, so the caller supplies the words.
  const act = (change: () => Promise<unknown>, whenRefused: string) => {
    run(change, (failure: unknown) =>
      isApiError(failure) && failure.status === 409 ? whenRefused : 'That did not work. Please try again.',
    )
  }

  return (
    <GuardedPage title="Your burn" require="member">
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

      {loaded.status === 'ready' && loaded.data.mine.event === null && (
        <p class="form-note">
          There is no burn open at the moment. When the next one is announced it will show up here.
        </p>
      )}

      {loaded.status === 'ready' && loaded.data.mine.event !== null && (
        <>
          <h2>{loaded.data.mine.event.name}</h2>

          {loaded.data.mine.attendance === null ? (
            <>
              <p>You have not said whether you are coming.</p>
              <p class="row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act(api.joinActiveEvent, 'That burn is no longer open.')}
                >
                  I am coming
                </button>
              </p>
            </>
          ) : (
            <>
              <p role="status">
                You are on the list for {loaded.data.mine.event.name}
                {paymentNote(loaded.data.mine.attendance.payment_status)}
              </p>
              <StayForm
                api={api}
                attendance={loaded.data.mine.attendance}
                lodgingOptions={loaded.data.lodging.filter((option) => option.kind === 'lodging')}
                helpingOptions={loaded.data.lodging.filter((option) => option.kind === 'helping')}
                taken={Object.fromEntries(loaded.data.lodging.map((option) => [option.id, option.taken]))}
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
                      api.leaveActiveEvent,
                      'You have already paid for this burn, so someone with admin needs to sort this one out with you.',
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
    </GuardedPage>
  )
}
