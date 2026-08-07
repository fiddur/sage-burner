import type { ApiClient } from '../api/client.ts'

import { forgetCachedMemberData } from '../offline.ts'
import { useSetViewer } from '../viewer.tsx'

/**
 * Signing out, from the page that says who you are signed in as.
 *
 * It used to sit in the bar, where it competed for space with the entries that go
 * somewhere — and where its neighbours are all places, not actions. It belongs
 * beside the sentence naming the account it ends.
 *
 * Rendered on **two** pages, for the reason ⚙️ keeps the Places and lodging links:
 * the details page is `require="member"`, and an account holding `admin` without
 * `member` is refused from it. Leaving them no way to sign out is worse than a
 * second button most people never see.
 */
export const LogOutButton = ({
  api,
  forget = forgetCachedMemberData,
}: {
  api: Pick<ApiClient, 'logout'>
  forget?: () => Promise<boolean>
}) => {
  const setViewer = useSetViewer()

  const logOut = async () => {
    // Before the request, not after: this is the half that has to happen. The cookie
    // expires on its own and a stale one reaches nothing, but a roster left in the
    // browser's cache is member data still on the device — and if the request throws
    // it is the branch that would have been skipped (#256).
    await forget()

    // The cookie is cleared server-side; the local viewer is cleared either way. A
    // failed logout that left the nav saying "Log out" would be worse than one that
    // says signed-out while a stale cookie expires on its own.
    //
    // Caught rather than only `finally`, which is what this had first: without a
    // catch the rejection escapes as an unhandled promise rejection, since the click
    // handler cannot await it. There is nothing to report — the user asked to be
    // signed out and, locally, they are.
    try {
      await api.logout()
    } catch {
      // Deliberately ignored; see above.
    }

    setViewer(null)
  }

  return (
    <p class="row">
      <button type="button" class="link-button" onClick={() => void logOut()}>
        Log out
      </button>
    </p>
  )
}
