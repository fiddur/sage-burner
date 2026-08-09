import type { OAuthProvider } from '@sage-burner/shared'
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
  /**
   * The same for the icon, which the settings page quotes as its preview's `?v=` (#376).
   *
   * It used to invent a literal `current`, which is a second live URL for one picture —
   * and two of those under one path evict each other in the offline cache.
   */
  icon?: string | null
  /**
   * Whether an admin has set an SMTP server up (#30). `undefined` until the answer
   * arrives, which the application form reads as "do not promise either way".
   */
  sendsEmail?: boolean
  /**
   * Which providers somebody may sign in from (#393).
   *
   * Here rather than fetched per page because both the login page and Your details need it,
   * and the login page needs it before anybody is signed in — which is why the installation
   * read carries it at all.
   */
  socialLogins?: readonly OAuthProvider[]
  setTitle: (title: string) => void
  setBanner: (banner: string | null) => void
  setIcon: (icon: string | null) => void
  setSendsEmail: (sends: boolean) => void
  setSocialLogins: (providers: readonly OAuthProvider[]) => void
}

const InstallationContext = createContext<InstallationContextValue>({
  setTitle: () => undefined,
  setBanner: () => undefined,
  setIcon: () => undefined,
  setSendsEmail: () => undefined,
  setSocialLogins: () => undefined,
})

const Provide = ({
  title,
  banner,
  icon,
  sendsEmail,
  socialLogins,
  children,
}: {
  title?: string
  banner?: string | null
  icon?: string | null
  sendsEmail?: boolean
  socialLogins?: readonly OAuthProvider[]
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
  const [iconOverride, setIconOverride] = useState<string | null | undefined>(undefined)
  const [mailOverride, setMailOverride] = useState<boolean | undefined>(undefined)
  const [loginsOverride, setLoginsOverride] = useState<readonly OAuthProvider[] | undefined>(undefined)
  const current = override ?? title

  useEffect(() => {
    if (current !== undefined) document.title = current
  }, [current])

  return (
    <InstallationContext.Provider
      value={{
        title: current,
        banner: bannerOverride === undefined ? banner : bannerOverride,
        icon: iconOverride === undefined ? icon : iconOverride,
        sendsEmail: mailOverride ?? sendsEmail,
        socialLogins: loginsOverride ?? socialLogins,
        setTitle: setOverride,
        setBanner: setBannerOverride,
        setIcon: setIconOverride,
        setSendsEmail: setMailOverride,
        setSocialLogins: setLoginsOverride,
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
  icon,
  sendsEmail,
  socialLogins,
}: {
  children: ComponentChildren
  title?: string
  banner?: string | null
  icon?: string | null
  sendsEmail?: boolean
  socialLogins?: readonly OAuthProvider[]
}) => (
  <Provide title={title} banner={banner} icon={icon} sendsEmail={sendsEmail} socialLogins={socialLogins}>
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
  const [icon, setIcon] = useState<string | null | undefined>(undefined)
  const [sendsEmail, setSendsEmail] = useState<boolean | undefined>(undefined)
  const [socialLogins, setSocialLogins] = useState<readonly OAuthProvider[] | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()

    api
      .getInstallation(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return
        setTitle(response.installation.title)
        setBanner(response.installation.banner_updated_at)
        setIcon(response.installation.icon_updated_at)
        setSendsEmail(response.installation.sends_email)
        setSocialLogins(response.installation.social_logins)
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
    <Provide title={title} banner={banner} icon={icon} sendsEmail={sendsEmail} socialLogins={socialLogins}>
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

/** The `?v=` of the app icon — the manifest's spelling of it (#376). */
export const useInstallationIcon = () => useContext(InstallationContext).icon

/** For the settings page, whose preview is the live route. */
export const useSetInstallationIcon = () => useContext(InstallationContext).setIcon

/**
 * Whether an invite will arrive by email, for the one public page that promises (#30).
 *
 * `undefined` while the answer is still coming, so the application form says the part
 * that is true either way rather than a promise it may have to take back.
 */
export const useInstallationSendsEmail = () => useContext(InstallationContext).sendsEmail

/** Empty until the read lands, and empty for an installation that configured none. */
export const useSocialLogins = (): readonly OAuthProvider[] =>
  useContext(InstallationContext).socialLogins ?? []

/** For the settings page, which has just turned mail on or off. */
export const useSetInstallationSendsEmail = () => useContext(InstallationContext).setSendsEmail
