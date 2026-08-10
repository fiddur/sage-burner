import type { ApiClient } from '../api/client.ts'

import { forgetCachedMemberData } from '../offline.ts'
import { useRemembered } from '../remembered.tsx'
import { useSetViewer } from '../viewer.tsx'

export const LogOutButton = ({
  api,
  forget = forgetCachedMemberData,
}: {
  api: Pick<ApiClient, 'logout'>
  forget?: () => Promise<boolean>
}) => {
  const setViewer = useSetViewer()
  const remembered = useRemembered()

  const logOut = async () => {
    remembered.forget()

    await forget()

    try {
      await api.logout()
    } catch {}

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
