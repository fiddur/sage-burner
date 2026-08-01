import type { ComponentChildren } from 'preact'

import { createContext } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'

import type { ApiClient } from './api/client.ts'

/**
 * What this deployment calls itself.
 *
 * `undefined` until the answer arrives, and consumers render nothing rather
 * than falling back to `Sage Burner`. That is the software's name: on an
 * installation called something else, showing it and then replacing it reads as
 * a bug, and a fallback spelled out here is a second copy of a default that
 * already lives in the migration.
 */
interface InstallationContextValue {
  title?: string
  setTitle: (title: string) => void
}

const InstallationContext = createContext<InstallationContextValue>({ setTitle: () => undefined })

const Provide = ({ title, children }: { title?: string; children: ComponentChildren }) => {
  // A rename on the settings page has to reach the header, which is a sibling
  // several levels up. The override wins over the fetched value for the same
  // reason it does for the viewer: at that point the local answer is the newer
  // one.
  const [override, setOverride] = useState<string | undefined>(undefined)
  const current = override ?? title

  useEffect(() => {
    if (current !== undefined) document.title = current
  }, [current])

  return (
    <InstallationContext.Provider value={{ title: current, setTitle: setOverride }}>
      {children}
    </InstallationContext.Provider>
  )
}

/** A known title, for tests and for anywhere the answer is already in hand. */
export const InstallationProvider = ({
  children,
  title,
}: {
  children: ComponentChildren
  title?: string
}) => <Provide title={title}>{children}</Provide>

/**
 * The provider the real app uses: asks the API.
 *
 * Split from `InstallationProvider` for the same reason as the viewer's pair —
 * a test states the title without a fetch, and this one is exercisable on its
 * own against an injected client.
 */
export const FetchedInstallationProvider = ({
  children,
  api,
}: {
  children: ComponentChildren
  api: Pick<ApiClient, 'getInstallation'>
}) => {
  const [title, setTitle] = useState<string | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()

    api
      .getInstallation(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setTitle(response.installation.title)
      })
      .catch(() => {
        // Nothing to report and nowhere to report it: this renders in the
        // header of the public homepage, and an error banner there for a name
        // is worse than the name being absent. The shell's own `<title>` stands.
      })

    return () => {
      controller.abort()
    }
  }, [api])

  return <Provide title={title}>{children}</Provide>
}

export const useInstallationTitle = () => useContext(InstallationContext).title

/** For the settings page, which already knows the new title. */
export const useSetInstallationTitle = () => useContext(InstallationContext).setTitle
