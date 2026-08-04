import type { ApiClient } from '../api/client.ts'

import { GuardedPage } from '../components/GuardedPage.tsx'
import { useLoad } from '../load.ts'
import { isApproved, useViewer } from '../viewer.tsx'

export type MembersApi = Pick<ApiClient, 'getActiveMembers'>

/**
 * Who else is coming, for the people coming with them.
 *
 * The read half of "a member may write their own record, and the burn's shared
 * furniture" (#159). Whoever is cooking needs the allergies, and those live on the
 * account precisely so somebody can read them — which was not true while the only
 * route serving them sat under `/api/admin/`.
 *
 * Read-only, all of it. Somebody else's stay is theirs to edit, and payment is not
 * on the page because it is not in the response.
 */
export const Members = ({ api }: { api: MembersApi }) => {
  const viewer = useViewer()
  const { loaded } = useLoad((signal) => api.getActiveMembers(signal), {
    enabled: isApproved(viewer),
    fallback: 'Could not load the list. Please reload the page.',
  })

  const roster = loaded.status === 'ready' ? loaded.data : undefined
  const confirmed = roster?.entries.filter((entry) => !entry.waiting).length ?? 0

  return (
    <GuardedPage title="Members" require="approved">
      <h1>Members</h1>

      {loaded.status === 'loading' && <p class="form-note">Loading…</p>}

      {loaded.status === 'failed' && (
        <p class="form-error" role="alert">
          {loaded.message}
        </p>
      )}

      {roster !== undefined && roster.event === null && (
        <p class="form-note">There is no burn open at the moment.</p>
      )}

      {roster !== undefined && roster.event !== null && (
        <>
          <h2>{roster.event.name}</h2>
          <p class="form-note">
            {confirmed} of {roster.event.member_cap} places taken
            {roster.entries.length > confirmed ? `, ${roster.entries.length - confirmed} waiting` : ''}.
          </p>

          {roster.entries.length === 0 ? (
            <p class="form-note">Nobody has said they are coming yet.</p>
          ) : (
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">Who</th>
                  <th scope="col">Allergies</th>
                  <th scope="col">Staying</th>
                  <th scope="col">Helping with</th>
                </tr>
              </thead>
              <tbody>
                {roster.entries.map((entry) => (
                  <tr key={entry.id} class={entry.waiting ? 'waiting' : undefined}>
                    <td>
                      {/* No fallback to the email address the way the organiser's
                          list has, because the response does not carry one. */}
                      {entry.name ?? 'Name not filled in yet'}
                      {entry.waiting && <span class="form-note"> · waiting</span>}
                      <br />
                      <span class="form-note">{entry.contact ?? 'no contact given'}</span>
                    </td>
                    <td>{entry.allergies_notes ?? '—'}</td>
                    <td>
                      {entry.arrival_date ?? '?'} → {entry.departure_date ?? '?'}
                      <br />
                      <span class="form-note">{entry.lodging ?? 'no lodging said'}</span>
                    </td>
                    <td>
                      {entry.helping ?? '—'}
                      {entry.helping_other !== null && (
                        <>
                          <br />
                          <span class="form-note">{entry.helping_other}</span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </GuardedPage>
  )
}
