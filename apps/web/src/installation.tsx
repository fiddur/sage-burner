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
  /**
   * When the banner was last uploaded — `null` for none, `undefined` until the
   * answer arrives (#306). It is the `?v=` the homepage's `<img>` quotes, so a new
   * banner is a new URL rather than whatever the browser already had.
   */
  banner?: string | null
  setTitle: (title: string) => void
  setBanner: (banner: string | null) => void
}

const InstallationContext = createContext<InstallationContextValue>({
  setTitle: () => undefined,
  setBanner: () => undefined,
})

const Provide = ({
  title,
  banner,
  children,
}: {
  title?: string
  banner?: string | null
  children: ComponentChildren
}) => {
  // A rename on the settings page has to reach the header, which is a sibling
  // several levels up. The override wins over the fetched value for the same
  // reason it does for the viewer: at that point the local answer is the newer
  // one. The banner is the same story one page over — it is uploaded under ⚙️ and
  // drawn on the homepage, and a client-side navigation between the two fetches
  // nothing.
  const [override, setOverride] = useState<string | undefined>(undefined)
  const [bannerOverride, setBannerOverride] = useState<string | null | undefined>(undefined)
  const current = override ?? title

  useEffect(() => {
    if (current !== undefined) document.title = current
  }, [current])

  return (
    <InstallationContext.Provider
      value={{
        title: current,
        banner: bannerOverride === undefined ? banner : bannerOverride,
        setTitle: setOverride,
        setBanner: setBannerOverride,
      }}
    >
      {children}
    </InstallationContext.Provider>
  )
}

/** A known installation, for tests and for anywhere the answer is already in hand. */
export const InstallationProvider = ({
  children,
  title,
  banner,
}: {
  children: ComponentChildren
  title?: string
  banner?: string | null
}) => (
  <Provide title={title} banner={banner}>
    {children}
  </Provide>
)

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
  const [banner, setBanner] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()

    api
      .getInstallation(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return
        setTitle(response.installation.title)
        setBanner(response.installation.banner_updated_at)
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

  return (
    <Provide title={title} banner={banner}>
      {children}
    </Provide>
  )
}

export const useInstallationTitle = () => useContext(InstallationContext).title

/** The homepage's banner, or `null` when nobody has uploaded one (#306). */
export const useInstallationBanner = () => useContext(InstallationContext).banner

/** For the settings page, which already knows the new title. */
export const useSetInstallationTitle = () => useContext(InstallationContext).setTitle

/** For the settings page, so the homepage draws the new banner without a reload. */
export const useSetInstallationBanner = () => useContext(InstallationContext).setBanner
